import { poissonAtLeast } from "@/lib/live/state";
import { normaliseName } from "@/lib/resolve/names";
import type { LivePlayer, LiveSnapshot } from "@/lib/live/snapshot";
import type { Settlement } from "@/lib/types";

/**
 * The ticket followed minute by minute. Each leg is won (already cleared), lost (already busted) or
 * alive with an estimated chance for the time that is left: counting stats blend the in-game pace
 * with the pre-match rate (the in-game share grows with the clock), scores use a simple margin
 * model. Every number here is an estimate and is labelled as one.
 */
export type LegState = "won" | "lost" | "alive" | "unknown";

export interface LegTrack { state: LegState; probability: number | null; current: number | null; reason: { pt: string; en: string }; flags: ("foul_trouble" | "benched")[] }

export interface PreMatch {
  /** Pre-match per-game average of the stat (player legs). */
  average?: number | null;
  /** Pre-match minutes per game (basketball players). */
  minutes?: number | null;
  /** Pre-match full-game total (game totals). */
  total?: number | null;
  /** Pre-match home handicap (negative = home favoured). */
  spread?: number | null;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const decided = (won: boolean, current: number, line: number): LegTrack => ({
  state: won ? "won" : "lost", probability: won ? 1 : 0, current, flags: [],
  reason: won ? { pt: `bateu: ${fmt(current)} contra ${fmt(line)}`, en: `cleared: ${fmt(current)} vs ${fmt(line)}` } : { pt: `caiu: ${fmt(current)} contra ${fmt(line)}`, en: `busted: ${fmt(current)} vs ${fmt(line)}` },
});
const unknown = (pt: string, en: string): LegTrack => ({ state: "unknown", probability: null, current: null, reason: { pt, en }, flags: [] });

function findPlayer(snap: LiveSnapshot, name: string | undefined): LivePlayer | null {
  if (!name) return null;
  const key = normaliseName(name);
  return snap.players.find((p) => normaliseName(p.name) === key) ?? null;
}

/** Over/under on a count that can only go up: chance of the final landing on the right side. */
function countLeg(current: number, line: number, side: "over" | "under", expectedRemaining: number, final: boolean): { state: LegState; probability: number } {
  if (side === "over" && current > line) return { state: "won", probability: 1 };
  if (side === "under" && current > line) return { state: "lost", probability: 0 };
  if (final) return { state: side === "over" ? "lost" : current < line ? "won" : "lost", probability: side === "over" ? 0 : current < line ? 1 : 0 };
  const needed = Math.floor(line) + 1 - current;
  const pOver = poissonAtLeast(needed, Math.max(0, expectedRemaining));
  return { state: "alive", probability: side === "over" ? pOver : 1 - pOver };
}

export function trackLeg(settlement: Settlement | undefined, labels: string[] | null, snap: LiveSnapshot, pre: PreMatch = {}): LegTrack {
  if (!settlement) return unknown("sem descritor para acompanhar", "nothing to track");
  const final = snap.state === "post";
  const remainingShare = 1 - snap.elapsed;
  const s = settlement;

  if (s.type === "player_prop" && labels && s.line !== undefined && (s.side === "over" || s.side === "under")) {
    const p = findPlayer(snap, s.player);
    if (!p) return unknown("jogador ainda sem estatística no jogo", "no stats for this player yet");
    const current = labels.reduce((a, l) => a + (p.stats[l] ?? 0), 0);
    const flags: LegTrack["flags"] = [];
    let expected: number;
    if (snap.sportGroup === "basketball") {
      const played = p.stats.MIN ?? 0;
      const projected = pre.minutes ?? Math.max(played / Math.max(snap.elapsed, 0.05), 20);
      let left = Math.max(0, projected * remainingShare);
      if ((p.stats.PF ?? 0) >= 5) { flags.push("foul_trouble"); left *= 0.6; }
      const inGame = played > 0 ? current / played : 0;
      const preRate = pre.average !== null && pre.average !== undefined && pre.minutes ? pre.average / pre.minutes : inGame;
      const rate = snap.elapsed * inGame + (1 - snap.elapsed) * preRate;
      expected = rate * left;
      const r = countLeg(current, s.line, s.side, expected, final);
      const need = Math.max(0, Math.floor(s.line) + 1 - current);
      return {
        ...r, current, flags,
        reason: r.state !== "alive" ? decided(r.state === "won", current, s.line).reason : {
          pt: `${fmt(current)} até agora; ${s.side === "over" ? `faltam ${need}` : `pode fazer mais ${Math.max(0, Math.ceil(s.line) - 1 - current)}`}, ~${Math.round(left)} min de quadra${flags.length ? " · 5 faltas: pode sentar" : ""}`,
          en: `${fmt(current)} so far; ${s.side === "over" ? `${need} to go` : `room for ${Math.max(0, Math.ceil(s.line) - 1 - current)} more`}, ~${Math.round(left)} min left on court${flags.length ? " · 5 fouls: may sit" : ""}`,
        },
      };
    }
    if (p.stats.STARTER === 0 && p.stats.SUBBED_IN === 0) flags.push("benched");
    const full = pre.average ?? Math.max(s.line, 0.5);
    expected = flags.includes("benched") ? full * remainingShare * 0.4 : full * remainingShare;
    const r = countLeg(current, s.line, s.side, expected, final);
    return {
      ...r, current, flags,
      reason: r.state !== "alive" ? decided(r.state === "won", current, s.line).reason : {
        pt: `${fmt(current)} até o minuto ${Math.round(snap.minute)}; esperado no tempo restante ${expected.toFixed(1)}${flags.length ? " · está no banco" : ""}`,
        en: `${fmt(current)} by minute ${Math.round(snap.minute)}; expected in the time left ${expected.toFixed(1)}${flags.length ? " · on the bench" : ""}`,
      },
    };
  }

  // Match counts in football (cards, corners, fouls): both teams' tallies against the line.
  const COUNT_STATS: Record<string, string[]> = { cards: ["YC", "RC"], yellow_cards: ["YC"], corners: ["CORNERS"], fouls: ["FC"], fouls_committed: ["FC"] };
  const countLabels = s.stat ? COUNT_STATS[s.stat] : undefined;
  if (snap.sportGroup === "soccer" && countLabels && (s.type === "total" || s.type === "other") && s.line !== undefined && (s.side === "over" || s.side === "under")) {
    const current = countLabels.reduce((a, l) => a + (snap.home.stats[l] ?? 0) + (snap.away.stats[l] ?? 0), 0);
    const expected = (pre.total ?? s.line + 0.5) * remainingShare;
    const r = countLeg(current, s.line, s.side, expected, final);
    return { ...r, current, flags: [], reason: r.state !== "alive" ? decided(r.state === "won", current, s.line).reason : { pt: `${current} até o minuto ${Math.round(snap.minute)}; esperado no tempo restante ${expected.toFixed(1)}`, en: `${current} by minute ${Math.round(snap.minute)}; expected in the time left ${expected.toFixed(1)}` } };
  }

  const margin = snap.home.score - snap.away.score;
  if (s.type === "total" && !s.teamAbbreviation && s.line !== undefined && (s.side === "over" || s.side === "under")) {
    const current = snap.home.score + snap.away.score;
    if (snap.sportGroup === "soccer") {
      const expected = (pre.total ?? s.line) * remainingShare;
      const r = countLeg(current, s.line, s.side, expected, final);
      return { ...r, current, flags: [], reason: r.state !== "alive" ? decided(r.state === "won", current, s.line).reason : { pt: `${current} gols até o minuto ${Math.round(snap.minute)} (estimativa)`, en: `${current} goals by minute ${Math.round(snap.minute)} (estimate)` } };
    }
    if (final) return decided(s.side === "over" ? current > s.line : current < s.line, current, s.line);
    const paceTotal = snap.elapsed > 0.05 ? current / snap.elapsed : (pre.total ?? s.line);
    const projected = snap.elapsed * paceTotal + (1 - snap.elapsed) * (pre.total ?? paceTotal);
    const mu = current + (projected - current) * 1;
    const sigma = Math.max(3, 18 * Math.sqrt(remainingShare));
    const pOver = 1 - normalCdf((s.line - mu) / sigma);
    return { state: "alive", probability: s.side === "over" ? pOver : 1 - pOver, current, flags: [], reason: { pt: `${current} pontos; ritmo projeta ${Math.round(mu)} (estimativa)`, en: `${current} points; pace projects ${Math.round(mu)} (estimate)` } };
  }

  if (s.type === "moneyline" && s.teamAbbreviation) {
    const home = s.teamAbbreviation === snap.home.abbr;
    const own = home ? margin : -margin;
    if (final) return decided(own > 0, own, 0);
    if (snap.sportGroup === "soccer") {
      const lambda = ((pre.total ?? 2.5) / 2) * remainingShare;
      let p = 0;
      for (let a = 0; a <= 8; a++) for (let b = 0; b <= 8; b++) if (own + a - b > 0) p += pois(a, lambda) * pois(b, lambda);
      return { state: "alive", probability: p, current: own, flags: [], reason: { pt: `placar ${snap.home.score}-${snap.away.score} no minuto ${Math.round(snap.minute)} (estimativa)`, en: `${snap.home.score}-${snap.away.score} at minute ${Math.round(snap.minute)} (estimate)` } };
    }
    const drift = -(pre.spread ?? 0) * remainingShare * (home ? 1 : -1);
    const sigma = Math.max(2, 12 * Math.sqrt(remainingShare));
    const p = 1 - normalCdf((0 - own - drift) / sigma);
    return { state: "alive", probability: p, current: own, flags: [], reason: { pt: `${own >= 0 ? "vence" : "perde"} por ${Math.abs(own)} com ${Math.round(snap.regulationMinutes - snap.minute)} min restantes (estimativa)`, en: `${own >= 0 ? "up" : "down"} ${Math.abs(own)} with ${Math.round(snap.regulationMinutes - snap.minute)} min left (estimate)` } };
  }
  return unknown("mercado sem acompanhamento ao vivo", "no live tracking for this market");
}

function pois(k: number, lambda: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-lambda) * lambda ** k) / f;
}

/** "Chance agora": the product of what is still alive (a lost leg makes it zero, won legs count as 1). */
export function ticketChance(legs: LegTrack[]): number | null {
  if (legs.some((l) => l.state === "lost")) return 0;
  if (legs.some((l) => l.state === "unknown")) return null;
  return legs.reduce((a, l) => a * (l.state === "won" ? 1 : l.probability ?? 0), 1);
}
