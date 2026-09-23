import {
  SIZING,
  applyCaps,
  calibratedProbability,
  grossEdge,
  growthScore,
  medicaoCaps,
  minAcceptableDecimal,
  shrinkFactor,
  stakeUnits,
  type CapKind,
  type Caps,
  type StakeMode,
} from "@/lib/bets/sizing";

/**
 * The day's short list. Pure: same candidates in, same selection out, no database and no clock of
 * its own — which is what makes the policy testable without a server.
 *
 * NOTHING is removed by this module. The ~15 tickets a game, the alternatives, the quarter reads,
 * the long bands, /app and /app/parlays all stay exactly where they are; this is a layer on top
 * that answers the only two questions the generator never answered: **which ones, and how much**.
 *
 * The cuts of §1.2, in order, all in code:
 *   1  pre-game, main ticket (never an alternative), game not under way
 *   2  evidenceScore = 100          (23.8 % hit vs 0 % below 100 on the ledger, p = 0.012)
 *   3  confidence ≠ low             (0 of 27 pre-game, p = 0.002)
 *   4  at most 2 legs
 *   5  odds in [1.30, 5.00]         — what kills the long bands without an ad-hoc rule
 *   6  raw model edge ≥ 4 %
 *   7  raw model edge ≤ 20 %        (above that: the admin's review queue, not the wallet)
 *   8  calibrated, shrunk edge ≥ 2 % — the wallet's gate, not applied in `medicao` (see below)
 *   9  every market canonically named; "unmapped" never enters
 *  10  at most 1 per game and 2 appearances of the same player in a day
 */

export type Scope = "pre" | "live";

export interface Candidate {
  ledgerId: string;
  suggestionId: string;
  gameId: string;
  sportKey: string;
  scope: Scope;
  bandKey: string;
  decimal: number;
  modelProbability: number;
  legs: number;
  /** Players the ticket touches, for the concentration rule. */
  players: string[];
  /** Canonical market keys (stat-key.ts). A `null` key is dropped upstream and lands in `unmapped`. */
  markets: string[];
  evidenceScore: number;
  confidence: "high" | "medium" | "low";
  startsAt: string;
  /** Live reads only: the quarter the read was taken in. */
  period?: number;
  /** Set when this ticket backs another one up. An alternative never enters the wallet. */
  alternativeOf?: string;
  title?: string;
  matchup?: string;
}

export type SkipReason =
  | "alternative" | "scope" | "evidence" | "confidence" | "legs" | "odds"
  | "edge_low" | "edge_high" | "shrunk_low" | "unmapped_market"
  | "game_taken" | "player_cap" | "below_floor" | "day_cap" | "quota";

export interface SelectedItem {
  candidate: Candidate;
  rank: number;
  calibratedProbability: number;
  grossEdge: number;
  shrunkEdge: number;
  k: number;
  score: number;
  units: number;
  pctOfBankroll: number;
  /** The worst price still worth taking. "Só vale até 1,33. Abaixo disso, passa." */
  minAcceptableDecimal: number;
  capped: CapKind;
  /** Live reads only: when the card stops being an answer to anything. */
  expiresAt?: string;
}

export interface DailySelection {
  day: string;
  sportKey: string;
  mode: StakeMode;
  /** The wallet: pre-game tickets with units on them. */
  items: SelectedItem[];
  /**
   * Live reads. They are part of the list and never part of the wallet: the price stored on a live
   * ticket is the pre-game table, inflated 1.64x at Q1 rising to 1.88x at Q4, so `units` stays 0
   * until the user confirms the price they actually got (§1.4).
   */
  live: SelectedItem[];
  skipped: { ledgerId: string; reason: SkipReason }[];
  totals: { units: number; pctOfBankroll: number; games: number };
  note: string;
}

export interface CalibrationContext {
  factorPre: number;
  factorLive: number;
  sigmaPPre: number;
  sigmaPLive: number;
  mode: StakeMode;
}

export interface SelectionContext {
  day: string;
  sportKey: string;
  calibration: CalibrationContext;
  caps?: Caps & { maxPerDay?: number; maxPerGame?: number; maxPerPlayer?: number; liveMaxPerNight?: number };
  now: number;
  /** Units already spent this week in the measurement regime, so its weekly budget binds. */
  medicaoWeekUsed?: number;
}

export const DEFAULT_CALIBRATION: CalibrationContext = {
  // Measured on the production ledger 2026-09-23: 172 pre-game legs at ratio 0.794, 419 live at 0.858,
  // both pulled to 1 with the 200-leg prior; σ_p is the de-biased RMSE of the calibration curve.
  factorPre: 0.905,
  factorLive: 0.904,
  sigmaPPre: 0.12,
  sigmaPLive: 0.11,
  mode: "medicao",
};

const started = (c: Candidate, now: number) => Number.isFinite(Date.parse(c.startsAt)) && Date.parse(c.startsAt) <= now;

interface Scored {
  candidate: Candidate;
  calibratedProbability: number;
  grossEdge: number;
  shrunkEdge: number;
  k: number;
  score: number;
}

/**
 * Deterministic order: growth first, then the shorter price, then the stronger evidence, then the
 * ledger id. Shuffling the input cannot change the output, and that is what makes the list testable.
 */
function ordered(rows: Scored[]): Scored[] {
  return [...rows].sort((a, b) =>
    b.score - a.score ||
    a.candidate.decimal - b.candidate.decimal ||
    b.candidate.evidenceScore - a.candidate.evidenceScore ||
    a.candidate.ledgerId.localeCompare(b.candidate.ledgerId));
}

/**
 * The pre-game cuts. `mode` matters for exactly one of them: cut 8 gates the **wallet**, and in the
 * measurement regime there is no wallet to gate — with the σ_p the ledger actually measures (0.12)
 * it would empty the list every night, which is the one outcome §2g rules out. Everything else,
 * including both raw-edge cuts, applies in every mode.
 */
function screen(
  candidates: Candidate[],
  ctx: SelectionContext,
  skipped: { ledgerId: string; reason: SkipReason }[],
): Scored[] {
  const { factorPre, sigmaPPre, mode } = ctx.calibration;
  const out: Scored[] = [];
  const skip = (c: Candidate, reason: SkipReason) => { skipped.push({ ledgerId: c.ledgerId, reason }); };

  for (const c of candidates) {
    if (c.alternativeOf) { skip(c, "alternative"); continue; }
    if (c.scope !== "pre" || started(c, ctx.now)) { skip(c, "scope"); continue; }
    if (c.evidenceScore !== 100) { skip(c, "evidence"); continue; }
    if (c.confidence === "low") { skip(c, "confidence"); continue; }
    if (!(c.legs >= 1) || c.legs > (SIZING.maxLegs as number)) { skip(c, "legs"); continue; }
    if (!(c.decimal >= SIZING.minOdds && c.decimal <= SIZING.maxOdds)) { skip(c, "odds"); continue; }

    const raw = grossEdge(c.decimal, c.modelProbability);
    if (!(raw >= SIZING.minEdgeGross)) { skip(c, "edge_low"); continue; }
    if (raw > SIZING.maxEdgeGross) { skip(c, "edge_high"); continue; }

    const pCal = calibratedProbability(c.modelProbability, c.legs, factorPre);
    const k = shrinkFactor(c.decimal, sigmaPPre);
    const shrunk = k * grossEdge(c.decimal, pCal);
    if (mode === "carteira" && !(shrunk >= SIZING.minEdgeShrunk)) { skip(c, "shrunk_low"); continue; }

    if (!c.markets.length || c.markets.some((m) => !m || m === "unmapped")) { skip(c, "unmapped_market"); continue; }

    out.push({ candidate: c, calibratedProbability: pCal, grossEdge: raw, shrunkEdge: shrunk, k, score: growthScore(c.decimal, shrunk) });
  }
  return out;
}

/** One per game, two appearances per player, three a night — in the ranked order, never by size. */
function concentrate(
  rows: Scored[],
  ctx: SelectionContext,
  skipped: { ledgerId: string; reason: SkipReason }[],
): Scored[] {
  const maxPerDay = ctx.caps?.maxPerDay ?? SIZING.maxPerDay;
  const maxPerGame = ctx.caps?.maxPerGame ?? SIZING.maxPerGame;
  const maxPerPlayer = ctx.caps?.maxPerPlayer ?? SIZING.maxPerPlayer;
  const games = new Map<string, number>();
  const players = new Map<string, number>();
  const kept: Scored[] = [];

  for (const row of rows) {
    const c = row.candidate;
    if (kept.length >= maxPerDay) { skipped.push({ ledgerId: c.ledgerId, reason: "quota" }); continue; }
    if ((games.get(c.gameId) ?? 0) >= maxPerGame) { skipped.push({ ledgerId: c.ledgerId, reason: "game_taken" }); continue; }
    if (c.players.some((p) => (players.get(p) ?? 0) + 1 > maxPerPlayer)) { skipped.push({ ledgerId: c.ledgerId, reason: "player_cap" }); continue; }
    kept.push(row);
    games.set(c.gameId, (games.get(c.gameId) ?? 0) + 1);
    for (const p of c.players) players.set(p, (players.get(p) ?? 0) + 1);
  }
  return kept;
}

/**
 * Live reads: at most two a night, a higher bar (8 % raw, to cover the in-play margin), a published
 * minimum price and ninety seconds of validity. Never a stake — the recorded price is the pre-game
 * table, and 109 % of the live balance is stale price. Q3 first: 69.8 % hit, CI95 [55; 81], the one
 * cut that repeats across all four quarters of the sample.
 */
function selectLive(
  candidates: Candidate[],
  ctx: SelectionContext,
  skipped: { ledgerId: string; reason: SkipReason }[],
): SelectedItem[] {
  const { factorLive, sigmaPLive } = ctx.calibration;
  const max = ctx.caps?.liveMaxPerNight ?? SIZING.liveMaxPerNight;
  const rows: Scored[] = [];

  for (const c of candidates) {
    if (c.alternativeOf) { skipped.push({ ledgerId: c.ledgerId, reason: "alternative" }); continue; }
    if (c.evidenceScore !== 100) { skipped.push({ ledgerId: c.ledgerId, reason: "evidence" }); continue; }
    if (c.confidence === "low") { skipped.push({ ledgerId: c.ledgerId, reason: "confidence" }); continue; }
    if (!(c.decimal > 1 && c.decimal <= SIZING.maxOdds)) { skipped.push({ ledgerId: c.ledgerId, reason: "odds" }); continue; }
    const raw = grossEdge(c.decimal, c.modelProbability);
    if (!(raw >= SIZING.minEdgeGrossLive)) { skipped.push({ ledgerId: c.ledgerId, reason: "edge_low" }); continue; }
    if (!c.markets.length || c.markets.some((m) => !m || m === "unmapped")) { skipped.push({ ledgerId: c.ledgerId, reason: "unmapped_market" }); continue; }
    const pCal = calibratedProbability(c.modelProbability, c.legs, factorLive);
    const k = shrinkFactor(c.decimal, sigmaPLive);
    const shrunk = k * grossEdge(c.decimal, pCal);
    rows.push({ candidate: c, calibratedProbability: pCal, grossEdge: raw, shrunkEdge: shrunk, k, score: growthScore(c.decimal, shrunk) });
  }

  // Q3 first, then growth. A third-quarter read at the same growth always outranks another quarter.
  const sorted = [...rows].sort((a, b) =>
    Number(b.candidate.period === 3) - Number(a.candidate.period === 3) ||
    b.score - a.score ||
    a.candidate.decimal - b.candidate.decimal ||
    a.candidate.ledgerId.localeCompare(b.candidate.ledgerId));

  const kept = sorted.slice(0, max);
  for (const row of sorted.slice(max)) skipped.push({ ledgerId: row.candidate.ledgerId, reason: "quota" });

  return kept.map((row, i) => ({
    candidate: row.candidate,
    rank: i + 1,
    calibratedProbability: row.calibratedProbability,
    grossEdge: row.grossEdge,
    shrunkEdge: row.shrunkEdge,
    k: row.k,
    score: row.score,
    units: 0,
    pctOfBankroll: 0,
    minAcceptableDecimal: minAcceptableDecimal(row.calibratedProbability, SIZING.minEdgeGrossLive),
    capped: "none" as CapKind,
    expiresAt: new Date(ctx.now + SIZING.liveValidityMs).toISOString(),
  }));
}

/** The day's answer. An empty `items` is a legitimate answer and this never throws to produce one. */
export function selectDaily(candidates: Candidate[], ctx: SelectionContext): DailySelection {
  const skipped: { ledgerId: string; reason: SkipReason }[] = [];
  const mode = ctx.calibration.mode;

  const pre = candidates.filter((c) => c.scope !== "live");
  const liveRaw = candidates.filter((c) => c.scope === "live");

  const screened = mode === "fechado" ? [] : screen(pre, ctx, skipped);
  const ranked = concentrate(ordered(screened), ctx, skipped);

  const caps: Caps = mode === "medicao" ? medicaoCaps(ctx.medicaoWeekUsed ?? 0) : { dayCapU: ctx.caps?.dayCapU, gameCapU: ctx.caps?.gameCapU, playerCapU: ctx.caps?.playerCapU };

  const sized = ranked.map((row) => {
    const s = stakeUnits({
      decimal: row.candidate.decimal,
      modelProbability: row.candidate.modelProbability,
      legs: row.candidate.legs,
      c: ctx.calibration.factorPre,
      sigmaP: ctx.calibration.sigmaPPre,
      mode,
    });
    return { row, units: s.units, capped: s.capped, gameId: row.candidate.gameId, players: row.candidate.players };
  });

  const capped = applyCaps(sized, caps);

  const items: SelectedItem[] = [];
  for (const r of capped) {
    if (r.units <= 0) {
      skipped.push({ ledgerId: r.row.candidate.ledgerId, reason: r.capped === "day" || r.capped === "game" ? "day_cap" : "below_floor" });
      continue;
    }
    items.push({
      candidate: r.row.candidate,
      rank: 0,
      calibratedProbability: r.row.calibratedProbability,
      grossEdge: r.row.grossEdge,
      shrunkEdge: r.row.shrunkEdge,
      k: r.row.k,
      score: r.row.score,
      units: r.units,
      pctOfBankroll: r.units * SIZING.unitPct,
      minAcceptableDecimal: minAcceptableDecimal(r.row.calibratedProbability, SIZING.minEdgeGross),
      capped: r.capped,
    });
  }
  items.forEach((item, i) => { item.rank = i + 1; });

  const live = mode === "fechado" ? [] : selectLive(liveRaw, ctx, skipped);
  const units = items.reduce((a, i) => a + i.units, 0);

  return {
    day: ctx.day,
    sportKey: ctx.sportKey,
    mode: items.length || live.length ? mode : "fechado",
    items,
    live,
    skipped,
    totals: { units: Number(units.toFixed(2)), pctOfBankroll: units * SIZING.unitPct, games: new Set(items.map((i) => i.candidate.gameId)).size },
    note: noteFor(mode, items.length, live.length),
  };
}

function noteFor(mode: StakeMode, items: number, live: number): string {
  if (!items && !live) return "no candidate cleared the cuts";
  if (mode === "medicao") return "measurement regime: every stake is the 0.25 u floor until the calibration closes";
  return `${items} ticket${items === 1 ? "" : "s"} sized by quarter Kelly on the shrunk edge`;
}

/**
 * The owner's hand-made ladder, kept visible beside the formula as a sanity anchor and, from §4.5,
 * as the other arm of a real A/B. It is a baseline, never the product's number: it has no way to
 * say "not this one", which is the answer that matters most.
 */
export function ladderUnits(decimal: number): number {
  if (!Number.isFinite(decimal) || decimal <= 1) return 0;
  if (decimal <= 5) return 1.25;
  if (decimal <= 10) return 1;
  if (decimal <= 20) return 0.75;
  return 0.25;
}
