/**
 * Does the fitted slope beat the single shift on the real ledger?
 *
 * Held out in TIME, never at random: the calibrator is fitted on the older legs and graded on the
 * newer ones, which is how it is actually used. An in-sample comparison hands the win to whichever
 * map has more parameters and proves nothing.
 *
 *   DATA_DIR=<dir with ledger/predictions.jsonl> pnpm tsx scripts/medir-calibracao.mts
 *
 * Prints, per scope, the Brier of the raw numbers, of the old intercept-only correction and of the
 * fitted map — plus the slope each slice earned, so a number that looks wrong can be traced to the
 * slice that produced it.
 */
import { readLedger } from "@/lib/ledger/store";
import { canonicalMarket } from "@/lib/ledger/stat-key";
import { fitPlatt, shrinkFit, applyFit, type PlattPoint, type PlattFit } from "@/lib/ledger/platt";
import { MIN_SAMPLE, PRIOR_STRENGTH, MAX_SHIFT } from "@/lib/ledger/recalibrate";

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (p: number) => Math.min(Math.max(p, 0.001), 0.999);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

interface Leg { p: number; y: 0 | 1; stat: string; market: string; source: string; t: string }
interface Slice { n: number; claimed: number; delivered: number; fit: PlattFit }

function legsOf(scope: "pre" | "live"): Leg[] {
  const out: Leg[] = [];
  for (const e of readLedger()) {
    if (e.outcome === "pending") continue;
    if ((e.scope === "live" ? "live" : "pre") !== scope) continue;
    for (const leg of e.legs) {
      if (leg.outcome !== "won" && leg.outcome !== "lost") continue;
      if (!Number.isFinite(leg.predictedProbability)) continue;
      out.push({
        p: leg.predictedProbability,
        y: leg.outcome === "won" ? 1 : 0,
        // The same key the calibrator uses, fallback included — 1,005 of 1,117 legs carry no
        // marketKey and are named at read time, so skipping the fallback would measure a ladder
        // nobody runs.
        stat: leg.marketKey ?? canonicalMarket(leg, e.sportKey) ?? "unmapped",
        market: leg.market ?? "",
        source: leg.sourceBasis ?? "",
        t: e.settledAt ?? e.createdAt ?? "",
      });
    }
  }
  return out.sort((a, b) => a.t.localeCompare(b.t));
}

function slices(legs: Leg[], key: (l: Leg) => string): Map<string, Slice> {
  const bag = new Map<string, Leg[]>();
  for (const l of legs) {
    const k = key(l);
    if (!k) continue;
    const list = bag.get(k);
    if (list) list.push(l); else bag.set(k, [l]);
  }
  const out = new Map<string, Slice>();
  for (const [k, ls] of bag) {
    if (ls.length < MIN_SAMPLE) continue;
    const points: PlattPoint[] = ls.map((l) => ({ predicted: l.p, won: l.y }));
    out.set(k, {
      n: ls.length,
      claimed: ls.reduce((a, l) => a + l.p, 0) / ls.length,
      delivered: ls.reduce((a, l) => a + l.y, 0) / ls.length,
      fit: fitPlatt(points),
    });
  }
  return out;
}

function report(scope: "pre" | "live", split: number, verbose: boolean) {
  const legs = legsOf(scope);
  console.log(`\n===== ${scope.toUpperCase()} — treino nos primeiros ${Math.round(split * 100)}% =====`);
  if (legs.length < 60) { console.log(`só ${legs.length} pernas liquidadas: amostra insuficiente`); return; }
  const cut = Math.floor(legs.length * split);
  const train = legs.slice(0, cut), test = legs.slice(cut);

  const byStat = slices(train, (l) => l.stat);
  const byMarket = slices(train, (l) => l.market);
  const bySource = slices(train, (l) => l.source);
  const pick = (l: Leg) => byStat.get(l.stat) ?? byMarket.get(l.market) ?? bySource.get(l.source) ?? null;

  /** The correction exactly as it shipped before 24/09: one shift, fitted at the slice's mean. */
  const oldMap = (s: Slice, p: number) => {
    const raw = logit(clamp(s.delivered)) - logit(clamp(s.claimed));
    const shift = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, raw * (s.n / (s.n + PRIOR_STRENGTH))));
    return clamp(sigmoid(logit(clamp(p)) + shift));
  };
  const newMap = (s: Slice, p: number) => applyFit(shrinkFit(s.fit, PRIOR_STRENGTH, MAX_SHIFT), p);

  /** The widest slice a leg belongs to: the one with the most evidence behind it. */
  const wide = (l: Leg) => bySource.get(l.source) ?? byMarket.get(l.market) ?? null;

  /**
   * Partial pooling: the narrow slice is not TRUSTED, it is blended toward the wide one in
   * proportion to its own sample. A 30-leg stat slice barely moves the 450-leg answer; a 300-leg one
   * mostly replaces it. This is what the ladder should have been doing instead of letting any slice
   * over 20 legs overrule everything wider.
   */
  const pooled = (l: Leg, map: (s: Slice, p: number) => number) => {
    const narrow = byStat.get(l.stat) ?? null;
    const w = wide(l);
    if (!narrow) return w ? map(w, l.p) : clamp(l.p);
    if (!w) return map(narrow, l.p);
    const k = narrow.n / (narrow.n + PRIOR_STRENGTH);
    return clamp(sigmoid(k * logit(map(narrow, l.p)) + (1 - k) * logit(map(w, l.p))));
  };

  /**
   * Inverse-variance pooling: the weight a slice gets is how much it actually knows relative to the
   * other, which for a rate estimated on n legs scales like n. A 75-leg stat slice against a
   * 456-leg market slice earns 14% of the say, not the 100% the current ladder hands it and not the
   * 65% a fixed prior would. Nothing here is tuned on this dataset — it is the standard weight.
   */
  const pooledInvVar = (l: Leg, map: (s: Slice, p: number) => number) => {
    const narrow = byStat.get(l.stat) ?? null;
    const w = wide(l);
    if (!narrow) return w ? map(w, l.p) : clamp(l.p);
    if (!w || narrow === w) return map(narrow, l.p);
    const k = narrow.n / (narrow.n + w.n);
    return clamp(sigmoid(k * logit(map(narrow, l.p)) + (1 - k) * logit(map(w, l.p))));
  };

  const variants: { name: string; f: (l: Leg) => number }[] = [
    { name: "cru (sem correção)", f: (l) => clamp(l.p) },
    { name: "escada atual + deslocamento", f: (l) => { const s = pick(l); return s ? oldMap(s, l.p) : clamp(l.p); } },
    { name: "escada atual + inclinação", f: (l) => { const s = pick(l); return s ? newMap(s, l.p) : clamp(l.p); } },
    { name: "só fatia larga + deslocamento", f: (l) => { const s = wide(l); return s ? oldMap(s, l.p) : clamp(l.p); } },
    { name: "só fatia larga + inclinação", f: (l) => { const s = wide(l); return s ? newMap(s, l.p) : clamp(l.p); } },
    { name: "pooling prior + deslocamento", f: (l) => pooled(l, oldMap) },
    { name: "pooling prior + inclinação", f: (l) => pooled(l, newMap) },
    { name: "pooling 1/var + deslocamento", f: (l) => pooledInvVar(l, oldMap) },
    { name: "pooling 1/var + inclinação", f: (l) => pooledInvVar(l, newMap) },
  ];

  const m = test.length;
  const covered = test.filter((l) => pick(l)).length;
  console.log(`treino ${train.length} · teste ${m} pernas (${covered} cobertas por uma fatia medida)`);
  console.log(`no teste: acerto real ${pct(test.reduce((a, l) => a + l.y, 0) / m)} contra ${pct(test.reduce((a, l) => a + l.p, 0) / m)} prometidos`);
  const scored = variants.map((v) => ({
    name: v.name,
    brier: test.reduce((acc, l) => acc + (v.f(l) - l.y) ** 2, 0) / m,
  }));
  const bRawScore = scored[0].brier;
  for (const s of scored)
    console.log(`  ${s.name.padEnd(32)} Brier ${s.brier.toFixed(4)}  ${s.brier === bRawScore ? "" : `${(((s.brier - bRawScore) / bRawScore) * 100).toFixed(1)}%`}`);
  const best = scored.reduce((a, b) => (b.brier < a.brier ? b : a));
  console.log(`>>> melhor: ${best.name}`);

  if (verbose)
    for (const [name, bag] of [["stat", byStat], ["mercado", byMarket], ["fonte", bySource]] as const)
      for (const [k, s] of [...bag].sort((a, b) => b[1].n - a[1].n).slice(0, 5))
        console.log(`  ${name}/${k}`.padEnd(32) + `n=${String(s.n).padStart(4)}  prometeu ${pct(s.claimed)} entregou ${pct(s.delivered)}  inclinação ${s.fit.slope.toFixed(2)}${s.fit.interceptOnly ? " (sem dispersão)" : ""}`);
}

// Three split points, because one is a coincidence waiting to be believed.
for (const split of [0.6, 0.7, 0.8]) {
  report("pre", split, split === 0.7);
  report("live", split, split === 0.7);
}
