import type { RateSample } from "@/lib/props/model";
import { MIN_RATE_MINUTES } from "@/lib/props/model";

/**
 * Same-game legs are not independent, and pricing them as if they were is how a slate hides its
 * real exposure. Two lines on one player are one bet on one night; two overs on one team share the
 * pace; a favourite's cover and its star's heavy over pull against each other because a blowout
 * removes the fourth quarter. This module turns those facts into a single factor on the product of
 * the leg probabilities — measured from the game logs where the two legs share enough games, a
 * documented rule otherwise — and prints every pair it adjusted.
 *
 * The factor is a product of pairwise lifts, P(A∧B) / (P(A)·P(B)). That is exact for two legs and
 * for independent legs; for three or more it is the log-linear approximation, so the total is
 * capped and the ticket can never be more likely than its least likely leg.
 *
 * "Criar Aposta" (bets/custom-parlay.ts) sidesteps the problem by allowing one leg per game; this
 * factor is what it would apply if it ever allowed two.
 */
export interface CorrLeg {
  athleteId?: string;
  player?: string;
  /** The player's team, or the team a moneyline/spread leg is on. */
  team?: string;
  type: "moneyline" | "spread" | "total" | "player_prop" | "other";
  /** Game-log labels of a player leg's stat (PTS, or PTS+REB+AST…). */
  labels?: string[] | null;
  line?: number;
  side?: string;
  probability: number;
  /** Per-game values for the stat, newest first, keyed by event id, for measured co-occurrence. */
  series?: RateSample[];
}

export interface PairLift {
  a: number;
  b: number;
  lift: number;
  basis: "measured" | "rule" | "nested" | "redundant";
  note: string;
}

export interface CorrelationResult {
  /** Multiply the independent product by this. 1 means independent. */
  factor: number;
  pairs: PairLift[];
  /** The probability after the factor and the "no more likely than its weakest leg" cap. */
  probability: number;
  independent: number;
  note: string;
}

export interface CorrContext {
  homeAbbr?: string;
  awayAbbr?: string;
  /** Home handicap: negative when the home side is favoured. */
  spread?: number | null;
}

/** Games both series must share before the measured lift outranks the rule. */
export const MIN_SHARED_GAMES = 12;
/** Pseudo-games of the rule prior in the shrinkage of a measured lift. */
const PRIOR_GAMES = 10;
const LIFT_FLOOR = 0.4;
const LIFT_CAP = 2.5;
const FACTOR_FLOOR = 0.3;
const FACTOR_CAP = 4;
/** A spread at which the favourite's closers are expected to sit. */
const BIG_FAVOURITE = 8;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const sameLabels = (a?: string[] | null, b?: string[] | null) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
const overlap = (a?: string[] | null, b?: string[] | null) => !!a && !!b && a.some((x) => b.includes(x));
const isOver = (l: CorrLeg) => l.side === "over";
const isUnder = (l: CorrLeg) => l.side === "under";
const hits = (value: number, l: CorrLeg) => (isUnder(l) ? value < (l.line ?? 0) : value > (l.line ?? 0));
const round2 = (x: number) => Number(x.toFixed(2));

/** Lift measured from the games two series share, shrunk toward the rule's prior. Null without a sample. */
export function measuredLift(a: CorrLeg, b: CorrLeg, prior: number): { lift: number; games: number } | null {
  if (!a.series?.length || !b.series?.length || a.line === undefined || b.line === undefined) return null;
  const byEvent = new Map(b.series.filter((s) => s.eventId && s.minutes >= MIN_RATE_MINUTES).map((s) => [s.eventId!, s.value]));
  let n = 0, ha = 0, hb = 0, hab = 0;
  for (const s of a.series) {
    if (!s.eventId || s.minutes < MIN_RATE_MINUTES) continue;
    const other = byEvent.get(s.eventId);
    if (other === undefined) continue;
    if (s.value === a.line || other === b.line) continue;
    n += 1;
    const okA = hits(s.value, a);
    const okB = hits(other, b);
    if (okA) ha += 1;
    if (okB) hb += 1;
    if (okA && okB) hab += 1;
  }
  if (n < MIN_SHARED_GAMES || ha === 0 || hb === 0) return null;
  const raw = ((hab + 0.5) * n) / ((ha + 0.5) * (hb + 0.5));
  return { lift: clamp((n * raw + PRIOR_GAMES * prior) / (n + PRIOR_GAMES), LIFT_FLOOR, LIFT_CAP), games: n };
}

interface Rule { lift: number; note: string }

/** The documented rule for a pair, before any measurement. */
export function ruleFor(a: CorrLeg, b: CorrLeg, ctx: CorrContext): Rule | null {
  const props = a.type === "player_prop" && b.type === "player_prop";
  const samePlayer = props && !!a.athleteId && a.athleteId === b.athleteId;
  const sameTeam = !!a.team && a.team === b.team;
  const sameSide = (isOver(a) && isOver(b)) || (isUnder(a) && isUnder(b));

  if (samePlayer) {
    if (overlap(a.labels, b.labels)) {
      return sameSide
        ? { lift: 1.25, note: "same player, overlapping stats, same side: one night decides both" }
        : { lift: 0.75, note: "same player, overlapping stats, opposite sides: the legs pull against each other" };
    }
    return sameSide
      ? { lift: 1.05, note: "same player, different stats: the minutes are shared" }
      : { lift: 0.97, note: "same player, different stats, opposite sides" };
  }

  if (props) {
    if (sameTeam) {
      const boards = sameLabels(a.labels, ["REB"]) && sameLabels(b.labels, ["REB"]);
      if (boards && sameSide) return { lift: 0.93, note: "teammates on the same boards compete for them" };
      return { lift: 1, note: sameSide ? "teammates, same side: usage competition offsets the shared pace" : "teammates, opposite sides" };
    }
    return sameSide
      ? { lift: 1.05, note: isOver(a) ? "opposing players, both over: a fast game feeds both" : "opposing players, both under: a slow game starves both" }
      : { lift: 0.97, note: "opposing players, opposite sides: one pace cannot favour both" };
  }

  const prop = a.type === "player_prop" ? a : b.type === "player_prop" ? b : null;
  const other = prop === a ? b : a;
  if (prop && other.type === "total" && (other.side === "over" || other.side === "under")) {
    const aligned = (isOver(prop) && other.side === "over") || (isUnder(prop) && other.side === "under");
    return aligned
      ? { lift: 1.1, note: "player line and game total on the same side share the pace" }
      : { lift: 0.92, note: "player line and game total on opposite sides" };
  }
  if (prop && (other.type === "spread" || other.type === "moneyline") && other.team) {
    const ownTeam = prop.team === other.team;
    const spread = ctx.spread ?? null;
    const favourite = spread === null || spread === 0 ? null : spread < 0 ? ctx.homeAbbr : ctx.awayAbbr;
    const bigFavourite = spread !== null && Math.abs(spread) >= BIG_FAVOURITE && other.team === favourite;
    if (ownTeam) {
      if (bigFavourite && isOver(prop)) return { lift: 0.9, note: "big favourite's cover and its player's over: a blowout removes her fourth quarter" };
      if (bigFavourite && isUnder(prop)) return { lift: 1.08, note: "big favourite's cover and its player's under: a blowout sits her" };
      return { lift: isOver(prop) ? 1.05 : 0.97, note: "player and her own team's result" };
    }
    return { lift: isOver(prop) ? 0.97 : 1.03, note: "player against the team the ticket backs" };
  }
  return null;
}

/**
 * The factor for a ticket. Pairs on the same player, same stat and same side are nested: the ticket
 * is the harder line and the easier one adds nothing, which is stated rather than priced.
 */
export function ticketCorrelation(legs: CorrLeg[], ctx: CorrContext = {}): CorrelationResult {
  const independent = legs.reduce((acc, l) => acc * l.probability, 1);
  const pairs: PairLift[] = [];
  let factor = 1;
  for (let i = 0; i < legs.length; i += 1) {
    for (let j = i + 1; j < legs.length; j += 1) {
      const a = legs[i], b = legs[j];
      const samePlayer = a.type === "player_prop" && b.type === "player_prop" && !!a.athleteId && a.athleteId === b.athleteId;
      if (samePlayer && sameLabels(a.labels, b.labels) && a.line !== undefined && b.line !== undefined) {
        const sameSide = a.side === b.side;
        if (sameSide) {
          // Over 19.5 and over 21.5: both land iff the higher line lands. P(both) = P(harder).
          const easier = isOver(a) ? (a.line < b.line ? a : b) : (a.line > b.line ? a : b);
          const lift = easier.probability > 0 ? 1 / easier.probability : 1;
          pairs.push({ a: i, b: j, lift: round2(lift), basis: "redundant", note: `${a.player}: ${a.side} ${a.line} and ${b.side} ${b.line} on the same stat are one bet — the easier line adds price and no probability` });
          factor *= lift;
        } else {
          // Over 19.5 and under 23.5: the total must land between. P = P(A) + P(B) − 1, floored.
          const joint = Math.max(0, a.probability + b.probability - 1);
          const lift = a.probability * b.probability > 0 ? joint / (a.probability * b.probability) : 0;
          pairs.push({ a: i, b: j, lift: round2(lift), basis: "nested", note: `${a.player}: between ${Math.min(a.line, b.line)} and ${Math.max(a.line, b.line)} on the same stat` });
          factor *= lift;
        }
        continue;
      }
      const rule = ruleFor(a, b, ctx);
      if (!rule) continue;
      const measured = measuredLift(a, b, rule.lift);
      if (measured) {
        pairs.push({ a: i, b: j, lift: round2(measured.lift), basis: "measured", note: `${a.player} & ${b.player}: co-occurrence over ${measured.games} shared games (rule ${rule.lift})` });
        factor *= measured.lift;
      } else if (Math.abs(rule.lift - 1) > 1e-9) {
        pairs.push({ a: i, b: j, lift: rule.lift, basis: "rule", note: rule.note });
        factor *= rule.lift;
      }
    }
  }
  factor = clamp(factor, FACTOR_FLOOR, FACTOR_CAP);
  const weakest = legs.length ? Math.min(...legs.map((l) => l.probability)) : 1;
  const probability = Math.min(independent * factor, weakest);
  const applied = legs.length ? probability / Math.max(independent, 1e-12) : 1;
  const note = pairs.length
    ? `correlation ×${round2(applied)}: ${pairs.map((p) => `${p.basis} ×${p.lift} (${p.note})`).join("; ")}`
    : "legs priced as independent";
  return { factor: round2(applied), pairs, probability, independent, note };
}
