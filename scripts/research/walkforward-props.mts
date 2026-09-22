/**
 * Walk-forward validation of the pre-game model (props/model.ts) and of the minutes baseline
 * (props/minutes.ts). For every player with 15 or more logged games and every game from the 11th
 * onward, the earlier games are the history; the model predicts P(over line) at six rungs around
 * the history's median in eight markets, and the realised value decides.
 *
 * Input, under RESEARCH_DIR (default scratchpad/espn): gamelog/<athleteId>.json, ESPN gamelog
 * payloads (site.api.espn.com/apis/common/v3/sports/basketball/wnba/athletes/<id>/gamelog?season=2026).
 *
 * Compared: the season hit rate at the line, the negative binomial over the game's ACTUAL minutes
 * (the rate model alone), the same over PROJECTED minutes (the production path), the minutes-
 * adjusted empirical rate, and the 70/30 blend the product uses. The numbers quoted in
 * props/model.ts and props/minutes.ts are this script's output on the 51 logs fetched 22/09/2026.
 *
 * Run from the repo root: npx tsx --tsconfig tsconfig.json scripts/research/walkforward-props.mts
 */
import fs from "node:fs";
import path from "node:path";
import { blendedProbability, fitRate, minutesAdjustedHitRate, projectLeg, type RateSample } from "@/lib/props/model";
import { projectMinutes } from "@/lib/props/minutes";

const DIR = process.env.RESEARCH_DIR ?? path.join(process.cwd(), "..", "scratchpad", "espn");
const MARKETS: Record<string, string[]> = { points: ["PTS"], rebounds: ["REB"], assists: ["AST"], threes: ["3PT"], pra: ["PTS", "REB", "AST"], pr: ["PTS", "REB"], pa: ["PTS", "AST"], ra: ["REB", "AST"] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
interface G { eventId: string; date: string; stats: Record<string, number> }
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
const series = (games: G[], labels: string[]): RateSample[] => games.map((g) => ({ eventId: g.eventId, value: labels.reduce((a, l) => a + (g.stats[l] ?? NaN), 0), minutes: g.stats.MIN ?? NaN })).filter((s) => Number.isFinite(s.value) && Number.isFinite(s.minutes));

interface Row { market: string; offset: number; y: number; p: Record<string, number> }
const rows: Row[] = [];
let minutesAbsError = 0, minutesBias = 0, minutesWithinSd = 0, minutesN = 0, players = 0;
/** Fitted dispersion per market over players with 20+ games: the source of DISPERSION_PRIOR in props/model.ts. */
const dispersions: Record<string, number[]> = {};
const HALFLIVES = [5, 10, 20, 40];

for (const file of fs.readdirSync(path.join(DIR, "gamelog"))) {
  const games = loadLog(path.join(DIR, "gamelog", file));
  if (games.length < 15) continue;
  players += 1;
  for (const [market, labels] of Object.entries(MARKETS)) {
    const all = series(games, labels);
    if (all.length < 15) continue;
    const whole = fitRate(all, { statLabels: labels });
    if (whole && all.length >= 20) (dispersions[market] ??= []).push(whole.dispersion);
    for (let i = 0; i < all.length - 10; i += 1) {
      const target = all[i];
      const hist = all.slice(i + 1);
      const fit = fitRate(hist, { statLabels: labels });
      if (!fit || target.minutes < 6) continue;
      const byHalflife = Object.fromEntries(HALFLIVES.map((h) => [h, fitRate(hist, { statLabels: labels, halflife: h })!]));
      const proj = projectMinutes({ player: file, minutes: hist.map((h) => h.minutes), regulationMinutes: 40 });
      if (!proj) continue;
      if (market === "points") {
        minutesAbsError += Math.abs(proj.expected - target.minutes);
        minutesBias += target.minutes - proj.expected;
        if (Math.abs(proj.expected - target.minutes) <= proj.sd) minutesWithinSd += 1;
        minutesN += 1;
      }
      const usable = hist.filter((h) => h.minutes >= 6).map((h) => h.value).sort((a, b) => a - b);
      const median = usable[Math.floor(usable.length / 2)];
      const steps = market === "threes" || market === "assists" || market === "rebounds" ? [-2, -1, 0, 1, 2, 3] : [-6, -3, 0, 3, 6, 9];
      for (const d of steps) {
        const line = Math.max(0.5, Math.round(median) + d - 0.5);
        const y = target.value > line ? 1 : 0;
        const hits = hist.filter((h) => h.value > line).length;
        const of = hist.filter((h) => h.value !== line).length;
        const season = (hits + 1) / (of + 2);
        const nbActual = projectLeg(fit, { expected: target.minutes, sd: 0.01 }, line, "over").pOver;
        const nbProjected = projectLeg(fit, { expected: proj.expected, sd: proj.sd }, line, "over").pOver;
        const empirical = minutesAdjustedHitRate(hist, fit, proj.expected, line, "over");
        rows.push({ market, offset: d, y, p: {
          seasonHitRate: season,
          nbActualMinutes: nbActual,
          nbProjectedMinutes: nbProjected,
          empiricalMinutesAdjusted: Number.isFinite(empirical) ? empirical : season,
          production: blendedProbability(nbProjected, hits, of),
          ...Object.fromEntries(HALFLIVES.map((h) => [`nbProjected_halflife${h}`, projectLeg(byHalflife[h], { expected: proj.expected, sd: proj.sd }, line, "over").pOver])),
        } });
      }
    }
  }
}

const cl = (p: number) => Math.min(0.995, Math.max(0.005, p));
const ll = (rs: Row[], k: string) => -rs.reduce((a, r) => a + (r.y ? Math.log(cl(r.p[k])) : Math.log(1 - cl(r.p[k]))), 0) / rs.length;
const brier = (rs: Row[], k: string) => rs.reduce((a, r) => a + (r.p[k] - r.y) ** 2, 0) / rs.length;
const cal = (rs: Row[], k: string) => {
  const b: Record<string, { n: number; p: number; y: number }> = {};
  for (const r of rs) { const i = String(Math.min(9, Math.floor(r.p[k] * 10))); const x = b[i] ??= { n: 0, p: 0, y: 0 }; x.n += 1; x.p += r.p[k]; x.y += r.y; }
  return Object.entries(b).sort().map(([i, x]) => `${i}:${(x.p / x.n * 100).toFixed(0)}/${(x.y / x.n * 100).toFixed(0)}`).join(" ");
};
console.log(`players ${players}, player-games ${minutesN}, line predictions ${rows.length}`);
for (const k of Object.keys(rows[0]?.p ?? {})) console.log(k.padEnd(26), "logloss", ll(rows, k).toFixed(4), "brier", brier(rows, k).toFixed(4), " cal", cal(rows, k));
console.log("\nby market (seasonHitRate / nbActual / nbProjected / production):");
for (const m of Object.keys(MARKETS)) { const rs = rows.filter((r) => r.market === m); if (rs.length) console.log(m.padEnd(9), rs.length, ["seasonHitRate", "nbActualMinutes", "nbProjectedMinutes", "production"].map((k) => ll(rs, k).toFixed(4)).join(" / ")); }
console.log("\nmedian fitted dispersion, players with 20+ games:", Object.entries(dispersions).map(([m, ds]) => { const x = [...ds].sort((a, b) => a - b); return `${m} ${x[Math.floor(x.length / 2)].toFixed(3)} (n=${x.length})`; }).join(", "));
console.log(`\nminutes baseline (recency-weighted mean + trend): MAE ${(minutesAbsError / minutesN).toFixed(2)}, bias ${(minutesBias / minutesN).toFixed(2)} (actual minus projected), within 1 sd ${(minutesWithinSd / minutesN * 100).toFixed(0)}% over ${minutesN} player-games`);
