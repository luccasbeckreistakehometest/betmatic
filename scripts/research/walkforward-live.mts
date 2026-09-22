/**
 * Walk-forward validation of the LIVE model (props/model.ts liveRate, props/minutes.ts
 * projectRemainingMinutes). At half-time of every finished game with play-by-play, for every player
 * with a log of ten or more earlier games, it predicts P(final > line) at six rungs around the
 * player's median in five markets and scores the prediction against the final box score.
 *
 * Inputs, under RESEARCH_DIR (default scratchpad/espn):
 *   gamelog/<athleteId>.json   ESPN gamelog payloads: site.api.espn.com/apis/common/v3/sports/basketball/wnba/athletes/<id>/gamelog?season=2026
 *   summaries/<eventId>.json   ESPN summaries WITH `plays`: site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=<id>
 * The half-time box score is rebuilt here from the play-by-play (scores, minutes from the
 * substitutions, points, rebounds, assists, fouls).
 *
 * Variants: the production rule (pre-game rate, mixture capped at the clock, REMAINING_SD_SCALE), the
 * width multiplier swept, a gamma-Poisson posterior moved toward tonight's production, a 70/30
 * pre-game/tonight blend, an uncapped mixture, and uniform second-half uplifts, plus the measured
 * second-half production against the pre-game rate. The numbers quoted in props/model.ts (liveRate)
 * and props/minutes.ts (REMAINING_SD_SCALE) are this script's output on the 194 games fetched 22/09/2026.
 *
 * Run from the repo root: npx tsx --tsconfig tsconfig.json scripts/research/walkforward-live.mts
 */
import fs from "node:fs";
import path from "node:path";
import { fitRate, liveRate, projectLeg, type RateSample } from "@/lib/props/model";
import { projectMinutes, projectRemainingMinutes, REMAINING_SD_SCALE } from "@/lib/props/minutes";

const DIR = process.env.RESEARCH_DIR ?? path.join(process.cwd(), "..", "scratchpad", "espn");
const PERIOD_MINUTES = 10;
const REGULATION = 40;
const MARKETS: Record<string, string[]> = { points: ["PTS"], rebounds: ["REB"], assists: ["AST"], pra: ["PTS", "REB", "AST"], pr: ["PTS", "REB"] };

// ESPN payloads are undocumented JSON; every access is optional-chained.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
interface G { eventId: string; date: string; stats: Record<string, number> }
interface HalfPlayer { team: string; MIN: number; PTS: number; REB: number; AST: number; PF: number }
interface HalfState { date: string; homeScore: number; awayScore: number; players: Record<string, HalfPlayer>; finals: Record<string, { MIN: number; PTS: number; REB: number; AST: number }>; spreadHome: number | null }

function loadLog(file: string): G[] {
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as Json;
  const labels: string[] = data.labels ?? [];
  const meta = (data.events ?? {}) as Record<string, Json>;
  const games: G[] = [];
  for (const st of (data.seasonTypes ?? []) as Json[]) for (const cat of (st.categories ?? []) as Json[]) for (const e of (cat.events ?? []) as Json[]) {
    const stats: Record<string, number> = {};
    labels.forEach((l, i) => { const raw = e.stats?.[i]; if (raw === undefined) return; const made = String(raw).match(/^(\d+)-/); stats[l] = made ? Number(made[1]) : Number(raw); });
    games.push({ eventId: String(e.eventId), date: meta[e.eventId]?.gameDate ?? "", stats });
  }
  return games.sort((a, b) => b.date.localeCompare(a.date));
}

const clockSeconds = (display: string): number => { const m = /^(\d+):(\d+)/.exec(display ?? ""); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };

/** The box score at the end of the second quarter, from the play-by-play. Null when the summary lacks plays or is not final. */
function halfTime(summary: Json): HalfState | null {
  const plays = (summary.plays ?? []) as Json[];
  const comp = summary.header?.competitions?.[0];
  if (!plays.length || comp?.status?.type?.state !== "post") return null;
  const players: Record<string, HalfPlayer> = {};
  const finals: HalfState["finals"] = {};
  const onCourt = new Set<string>();
  const enteredAt: Record<string, number> = {};
  for (const grp of (summary.boxscore?.players ?? []) as Json[]) {
    const team = String(grp.team?.abbreviation ?? "");
    const labels: string[] = grp.statistics?.[0]?.labels ?? [];
    for (const a of (grp.statistics?.[0]?.athletes ?? []) as Json[]) {
      const id = String(a.athlete?.id ?? "");
      players[id] = { team, MIN: 0, PTS: 0, REB: 0, AST: 0, PF: 0 };
      if (a.starter) { onCourt.add(id); enteredAt[id] = 0; }
      const raw: string[] = a.stats ?? [];
      if (raw.length) {
        const row: Record<string, string> = {};
        labels.forEach((l, i) => { row[l] = raw[i]; });
        finals[id] = { MIN: Number(row.MIN), PTS: Number(row.PTS), REB: Number(row.REB), AST: Number(row.AST) };
      }
    }
  }
  let score: [number, number] = [0, 0];
  for (const p of plays) {
    const period = Number(p.period?.number ?? 0);
    if (period > 2) break;
    const t = (period - 1) * PERIOD_MINUTES * 60 + (PERIOD_MINUTES * 60 - clockSeconds(p.clock?.displayValue));
    const type = String(p.type?.text ?? "");
    const text = String(p.text ?? "");
    const parts: string[] = ((p.participants ?? []) as Json[]).map((x) => String(x.athlete?.id ?? ""));
    if (type === "Substitution" && parts.length === 2) {
      const [inn, out] = parts;
      if (onCourt.has(out)) {
        if (players[out]) players[out].MIN += t - (enteredAt[out] ?? t);
        onCourt.delete(out);
      }
      onCourt.add(inn); enteredAt[inn] = t;
      continue;
    }
    if (p.scoringPlay && parts[0] && players[parts[0]]) {
      players[parts[0]].PTS += Number(p.scoreValue ?? 0);
      if (/assists/.test(text) && parts[1] && players[parts[1]]) players[parts[1]].AST += 1;
    }
    if (/Rebound$/.test(type) && parts[0] && players[parts[0]]) players[parts[0]].REB += 1;
    if (/Foul/.test(type) && !/Offensive Foul Turnover/.test(type) && parts[0] && players[parts[0]]) players[parts[0]].PF += 1;
    score = [Number(p.awayScore ?? score[0]), Number(p.homeScore ?? score[1])];
  }
  const end = 2 * PERIOD_MINUTES * 60;
  for (const id of onCourt) if (players[id]) players[id].MIN += end - (enteredAt[id] ?? end);
  for (const id of Object.keys(players)) players[id].MIN = Math.round(players[id].MIN / 6) / 10;
  const home = ((comp.competitors ?? []) as Json[]).find((c) => c.homeAway === "home");
  const pick = (summary.pickcenter ?? [])[0] as Json | undefined;
  let spreadHome: number | null = null;
  const m = /^([A-Z]{2,4})\s*([+-]?\d+(?:\.\d+)?)/.exec(String(pick?.details ?? ""));
  if (m) spreadHome = m[1] === home?.team?.abbreviation ? Number(m[2]) : -Number(m[2]);
  return { date: String(comp.date ?? ""), awayScore: score[0], homeScore: score[1], players, finals, spreadHome };
}

const logs = new Map<string, G[]>();
for (const f of fs.readdirSync(path.join(DIR, "gamelog"))) logs.set(f.replace(".json", ""), loadLog(path.join(DIR, "gamelog", f)));
const halves: Record<string, HalfState> = {};
for (const f of fs.readdirSync(path.join(DIR, "summaries"))) {
  try {
    const state = halfTime(JSON.parse(fs.readFileSync(path.join(DIR, "summaries", f), "utf8")) as Json);
    if (state) halves[f.replace(".json", "")] = state;
  } catch { /* a malformed summary is skipped */ }
}

interface Row { market: string; y: number; p: Record<string, number> }
const rows: Row[] = [];
/** Second-half production against the pre-game rate over the second-half minutes actually played, per market. */
const uplift: Record<string, { produced: number; expected: number }> = {};
const cl = (p: number) => Math.min(0.995, Math.max(0.005, p));
const sum = (o: Record<string, number>, labels: string[]) => labels.reduce((a, l) => a + (o[l] ?? 0), 0);
const SCALES = [1, 1.5, 2, 2.5, 3];

for (const [gid, game] of Object.entries(halves)) {
  for (const [aid, ht] of Object.entries(game.players)) {
    const log = logs.get(aid);
    const fin = game.finals[aid];
    if (!log || !fin || ht.MIN < 6 || fin.MIN < 10) continue;
    const before = log.filter((g) => g.date < game.date && g.eventId !== gid);
    if (before.length < 10) continue;
    const minutes = before.map((g) => g.stats.MIN).filter(Number.isFinite);
    const pre = projectMinutes({ player: aid, minutes, regulationMinutes: REGULATION, expectedMargin: game.spreadHome ?? null });
    const margin = game.homeScore - game.awayScore;
    const remainingFor = (sdScale: number) => projectRemainingMinutes({ player: aid, preGame: pre, minutesPlayed: ht.MIN, minutesElapsed: 20, minutesLeft: 20, regulationMinutes: REGULATION, fouls: ht.PF, currentMargin: margin, expectedMargin: game.spreadHome ?? 0, sdScale });
    const remaining = Object.fromEntries(SCALES.map((s) => [s, remainingFor(s)]));
    const production = remainingFor(REMAINING_SD_SCALE);
    for (const [market, labels] of Object.entries(MARKETS)) {
      const series: RateSample[] = before.map((g) => ({ eventId: g.eventId, value: sum(g.stats, labels), minutes: g.stats.MIN })).filter((s) => Number.isFinite(s.value) && Number.isFinite(s.minutes));
      const fit = fitRate(series, { statLabels: labels });
      if (!fit) continue;
      const current = sum(ht as unknown as Record<string, number>, labels);
      const final = sum(fin as unknown as Record<string, number>, labels);
      const u = uplift[market] ??= { produced: 0, expected: 0 };
      u.produced += final - current;
      u.expected += fit.rate * Math.max(0, fin.MIN - ht.MIN);
      const vals = series.filter((s) => s.minutes >= 6).map((s) => s.value).sort((a, b) => a - b);
      const median = vals[Math.floor(vals.length / 2)];
      const steps = market === "rebounds" || market === "assists" ? [-2, -1, 0, 1, 2, 3] : [-6, -3, 0, 3, 6, 9];
      for (const d of steps) {
        const line = Math.max(0.5, Math.round(median) + d - 0.5);
        if (current > line) continue;
        const y = final > line ? 1 : 0;
        const rate = liveRate(fit, { value: current, minutes: ht.MIN });
        const p: Record<string, number> = {};
        p.production = projectLeg(rate, production, line, "over", { current, maxMinutes: 20 }).pOver;
        for (const s of SCALES) p[`capped_sd${s}`] = projectLeg(rate, remaining[s], line, "over", { current, maxMinutes: 20 }).pOver;
        p.uncapped = projectLeg(rate, production, line, "over", { current }).pOver;
        // A gamma-Poisson posterior: the between-game shape updated by tonight's count over tonight's minutes.
        const shape = 1 / fit.dispersion;
        const posteriorRate = (shape + current) / (shape / fit.rate + ht.MIN);
        p.posterior = projectLeg({ rate: posteriorRate, dispersion: 1 / (shape + current) }, production, line, "over", { current, maxMinutes: 20 }).pOver;
        p.blend70pre = projectLeg({ rate: 0.7 * fit.rate + 0.3 * rate.tonightRate, dispersion: fit.dispersion }, production, line, "over", { current, maxMinutes: 20 }).pOver;
        p.tonightOnly = projectLeg({ rate: rate.tonightRate, dispersion: fit.dispersion }, production, line, "over", { current, maxMinutes: 20 }).pOver;
        for (const k of [1.03, 1.06]) p[`uplift${k}`] = projectLeg({ rate: fit.rate * k, dispersion: fit.dispersion }, production, line, "over", { current, maxMinutes: 20 }).pOver;
        rows.push({ market, y, p });
      }
    }
  }
}

const ll = (rs: Row[], k: string) => -rs.reduce((a, r) => a + (r.y ? Math.log(cl(r.p[k])) : Math.log(1 - cl(r.p[k]))), 0) / rs.length;
const cal = (rs: Row[], k: string) => {
  const b: Record<string, { n: number; p: number; y: number }> = {};
  for (const r of rs) { const i = String(Math.min(9, Math.floor(r.p[k] * 10))); const x = b[i] ??= { n: 0, p: 0, y: 0 }; x.n += 1; x.p += r.p[k]; x.y += r.y; }
  return Object.entries(b).sort().map(([i, x]) => `${i}:${(x.p / x.n * 100).toFixed(0)}/${(x.y / x.n * 100).toFixed(0)}(${x.n})`).join(" ");
};
console.log(`games ${Object.keys(halves).length}, rows ${rows.length}`);
for (const k of Object.keys(rows[0]?.p ?? {})) console.log(k.padEnd(14), "logloss", ll(rows, k).toFixed(4), " cal", cal(rows, k));
console.log("\nsecond-half production over the pre-game rate × second-half minutes, by market:", Object.entries(uplift).map(([m, u]) => `${m} ${(u.produced / u.expected).toFixed(3)}`).join(", "));
console.log("\nby market (production / posterior / blend70pre / uncapped):");
for (const m of Object.keys(MARKETS)) { const rs = rows.filter((r) => r.market === m); if (rs.length) console.log(m.padEnd(9), rs.length, ["production", "posterior", "blend70pre", "uncapped"].map((k) => ll(rs, k).toFixed(4)).join(" / ")); }
