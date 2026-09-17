import type { Settlement } from "@/lib/types";

/**
 * Múltipla sob medida. The user names a payout; a deterministic search picks the best-evidenced way to
 * get there from priced legs — or says it cannot be done and how close it gets. The model never picks
 * a leg or a number here; it only writes the explanation afterwards.
 */
export interface PoolLeg {
  /** Unique within the pool. */
  key: string;
  gameId: string;
  matchup: string;
  selection: string;
  /** moneyline | total | spread | draw | a player MarketDef key. */
  market: string;
  decimal: number;
  /** Honest chance: the measured rate (lightly shrunk) for props, the no-vig price shrunk to 50% otherwise. */
  fairProbability: number;
  measured: boolean;
  measuredRate: number | null;
  evidence: string;
  settlement: Settlement;
  athleteId?: string;
}

export interface CustomConstraints {
  /** Target payout, 2x–500x. */
  target: number;
  maxLegs: number;
  minLegs?: number;
  /** Only these markets (empty = all). */
  markets?: string[];
  excludeMarkets?: string[];
  gameIds?: string[];
  /** Only legs with a measured record. */
  measuredOnly: boolean;
  /** Floor on each measured leg's rate (0–1). */
  minRate: number;
}

export interface SolvedTicket { legs: PoolLeg[]; decimal: number; fairProbability: number; ev: number }
export interface SolveResult { reachable: boolean; tickets: SolvedTicket[]; nearest: number | null; reason: "ok" | "empty_pool" | "too_high" | "too_low" }

export const TOLERANCE = { low: 0.85, high: 1.25 } as const;
export const CUSTOM_LIMITS = { minTarget: 2, maxTarget: 500, minLegs: 2, maxLegs: 8 } as const;

export function filterPool(pool: PoolLeg[], c: CustomConstraints): PoolLeg[] {
  const markets = new Set(c.markets ?? []);
  const excluded = new Set(c.excludeMarkets ?? []);
  const games = new Set(c.gameIds ?? []);
  return pool.filter((leg) =>
    Number.isFinite(leg.decimal) && leg.decimal > 1 &&
    leg.fairProbability > 0 && leg.fairProbability < 1 &&
    (!markets.size || markets.has(leg.market)) &&
    !excluded.has(leg.market) &&
    (!games.size || games.has(leg.gameId)) &&
    (!c.measuredOnly || leg.measured) &&
    (!leg.measured || (leg.measuredRate ?? 0) >= c.minRate),
  );
}

interface State { idx: number[]; games: Set<string>; logDec: number; logP: number }

const compareKeys = (a: PoolLeg[], b: PoolLeg[]) => a.map((l) => l.key).join("|").localeCompare(b.map((l) => l.key).join("|"));

/**
 * Beam search over combinations (one leg per game), maximising the product of fair chances with the
 * combined price inside [target × 0.85, target × 1.25]. Partial states are ranked by chance kept per
 * unit of log-odds gained, so the beam keeps the legs that buy price most cheaply. Deterministic for
 * the same input: the pool is sorted by key and every tie is broken by key.
 */
export function solveCustomParlay(pool: PoolLeg[], c: CustomConstraints, opts: { beam?: number; results?: number } = {}): SolveResult {
  const beam = opts.beam ?? 200;
  const wanted = opts.results ?? 3;
  const legs = filterPool(pool, c).sort((a, b) => a.key.localeCompare(b.key));
  if (!legs.length) return { reachable: false, tickets: [], nearest: null, reason: "empty_pool" };
  const minLegs = Math.max(CUSTOM_LIMITS.minLegs, c.minLegs ?? CUSTOM_LIMITS.minLegs);
  const maxLegs = Math.min(CUSTOM_LIMITS.maxLegs, Math.max(minLegs, c.maxLegs));
  const lo = Math.log(c.target * TOLERANCE.low);
  const hi = Math.log(c.target * TOLERANCE.high);
  const logTarget = Math.log(c.target);
  const logD = legs.map((l) => Math.log(l.decimal));
  const logP = legs.map((l) => Math.log(l.fairProbability));

  let frontier: State[] = [{ idx: [], games: new Set(), logDec: 0, logP: 0 }];
  const found: State[] = [];
  let nearest: { dist: number; logDec: number } | null = null;

  for (let depth = 1; depth <= maxLegs; depth++) {
    const next: State[] = [];
    for (const s of frontier) {
      const start = s.idx.length ? s.idx[s.idx.length - 1] + 1 : 0;
      for (let i = start; i < legs.length; i++) {
        if (s.games.has(legs[i].gameId)) continue;
        const logDec = s.logDec + logD[i];
        if (logDec > hi + 1e-9) {
          // Past the window: still the nearest achievable price when nothing lands inside it.
          const dist = Math.abs(logDec - logTarget);
          if (depth >= minLegs && (!nearest || dist < nearest.dist)) nearest = { dist, logDec };
          continue;
        }
        const state: State = { idx: [...s.idx, i], games: new Set([...s.games, legs[i].gameId]), logDec, logP: s.logP + logP[i] };
        if (depth >= minLegs) {
          const dist = Math.abs(logDec - logTarget);
          if (!nearest || dist < nearest.dist) nearest = { dist, logDec };
          if (logDec >= lo - 1e-9) found.push(state);
        }
        next.push(state);
      }
    }
    if (!next.length) break;
    const efficiency = (s: State) => s.logP / Math.max(s.logDec, 1e-6);
    next.sort((a, b) => efficiency(b) - efficiency(a) || a.idx.join(",").localeCompare(b.idx.join(",")));
    frontier = next.slice(0, beam);
  }

  const toTicket = (s: State): SolvedTicket => {
    const chosen = s.idx.map((i) => legs[i]);
    const decimal = chosen.reduce((a, l) => a * l.decimal, 1);
    const fair = chosen.reduce((a, l) => a * l.fairProbability, 1);
    return { legs: chosen, decimal, fairProbability: fair, ev: fair * decimal - 1 };
  };
  const tickets = found
    .map(toTicket)
    .sort((a, b) => b.fairProbability - a.fairProbability || compareKeys(a.legs, b.legs))
    .slice(0, wanted);
  if (tickets.length) return { reachable: true, tickets, nearest: tickets[0].decimal, reason: "ok" };
  const nearestDecimal = nearest ? Math.exp(nearest.logDec) : null;
  return { reachable: false, tickets: [], nearest: nearestDecimal, reason: nearestDecimal !== null && nearestDecimal > c.target ? "too_low" : "too_high" };
}

/** A measured rate pulled two games toward the market's fair chance, so 5/5 never reads as certain. */
export function shrinkMeasured(hits: number, of: number, marketFair: number): number {
  const prior = Number.isFinite(marketFair) ? marketFair : 0.5;
  return Math.min(0.97, Math.max(0.03, (hits + 2 * prior) / (of + 2)));
}

/** A market's no-vig chance nudged 5% toward a coin flip: the solver should not trust the book blindly. */
export function shrinkToHalf(p: number): number {
  return Math.min(0.97, Math.max(0.03, p + (0.5 - p) * 0.05));
}
