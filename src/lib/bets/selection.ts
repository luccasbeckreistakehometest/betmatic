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
  | "game_taken" | "player_cap" | "below_floor" | "day_cap" | "quota"
  | "period_unmeasured";

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
  /**
   * Live reads only: the quarter whose own measurement corrected this read's chance, and how far
   * that quarter's promise sat from what happened. `null` when the scope-wide factor was used
   * because the quarter has no verdict of its own yet.
   */
  periodCalibration?: { period: number; settled: number; gapPoints: number } | null;
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
  /**
   * The live scope measured one quarter at a time, keyed by period. A live read is corrected by its
   * OWN quarter, never by the scope average: on the ledger of 22/09 the scope average hides a
   * 24-point spread between the quarter that keeps its promise and the ones that do not.
   */
  livePeriods?: Record<number, { settled: number; factor: number; sigmaP: number; gapPoints: number }>;
}

export interface SelectionContext {
  day: string;
  sportKey: string;
  calibration: CalibrationContext;
  caps?: Caps & { maxPerDay?: number; maxPerGame?: number; maxPerPlayer?: number; liveMaxPerNight?: number };
  now: number;
  /** Units already spent this week in the measurement regime, so its weekly budget binds. */
  medicaoWeekUsed?: number;
  /**
   * Which arm of the stake A/B (§2f, §4.5) sizes this day: the formula, or the owner's band ladder.
   * It changes only the **size**, never the list — that is the whole point of the comparison, since
   * what cut 737 u a night down to 3.25 u was the selection, not the arithmetic on top of it.
   *
   * It has no effect in `medicao`, and that is deliberate rather than an oversight: the measurement
   * regime pays the floor by definition, and serving 1.25 u from the ladder while the screen says
   * "a carteira está em calibração" would be the product contradicting itself in the same card. The
   * arm is still filed on every row from day one, so the day a slice opens to `carteira` the
   * comparison starts with its history already in place.
   */
  stakePolicy?: "formula" | "escada";
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

/** Below this many decided legs a quarter has no verdict, so it cannot correct anything. */
export const PERIOD_MIN_LEGS = 20;

/**
 * Live reads: at most two a night, a higher bar (8 % raw, to cover the in-play margin), a published
 * minimum price and ninety seconds of validity. Never a stake — the recorded price is the pre-game
 * board, which by the third quarter no book is still offering, so a return computed from it is a
 * number nobody could have collected.
 *
 * The ordering is no longer "Q3 first" written by hand. Measured at fair price on the ledger of
 * 22/09 (168 unique decided legs, `ledger-live-20260922.jsonl`), the live scope promised 93.4 % and
 * delivered 78.0 % — 15.4 points of overconfidence, z = -8.55 — and that average hides the only
 * thing worth knowing:
 *
 *     Q1  n=17  no verdict (under the 20-leg gate)
 *     Q2  n=48  -19.5 points
 *     Q3  n=52   -4.0 points   ← the only quarter that roughly keeps its promise
 *     Q4  n=51  -21.6 points
 *
 * The same table on the served chance rather than the computed one reads -15.2 / -14.1 / +1.9 /
 * -15.1: the levels move with the ruler, the ordering does not. So the rule the code states is the
 * one the data states — **a read is corrected by its own quarter's measurement, and a quarter with
 * no verdict yet cannot correct anything** — and on today's sample that elects Q3 on its own,
 * without Q3 ever being named here. The day Q2 starts keeping its promise, this ranks it.
 */
function selectLive(
  candidates: Candidate[],
  ctx: SelectionContext,
  skipped: { ledgerId: string; reason: SkipReason }[],
): SelectedItem[] {
  const { factorLive, sigmaPLive, livePeriods } = ctx.calibration;
  const max = ctx.caps?.liveMaxPerNight ?? SIZING.liveMaxPerNight;
  const rows: (Scored & { period: SelectedItem["periodCalibration"] })[] = [];

  /**
   * The quarter's own measurement, or null when it has none. A quarter under the gate is not
   * "probably fine": it is unmeasured, and the read it carries is published with the scope factor
   * and said to be unmeasured rather than dressed up in a precision nobody has earned.
   */
  const periodOf = (q: number | undefined): SelectedItem["periodCalibration"] => {
    const slice = q === undefined ? undefined : livePeriods?.[q];
    return slice && slice.settled >= PERIOD_MIN_LEGS
      ? { period: q!, settled: slice.settled, gapPoints: slice.gapPoints }
      : null;
  };

  for (const c of candidates) {
    if (c.alternativeOf) { skipped.push({ ledgerId: c.ledgerId, reason: "alternative" }); continue; }
    if (c.evidenceScore !== 100) { skipped.push({ ledgerId: c.ledgerId, reason: "evidence" }); continue; }
    if (c.confidence === "low") { skipped.push({ ledgerId: c.ledgerId, reason: "confidence" }); continue; }
    if (!(c.decimal > 1 && c.decimal <= SIZING.maxOdds)) { skipped.push({ ledgerId: c.ledgerId, reason: "odds" }); continue; }
    const raw = grossEdge(c.decimal, c.modelProbability);
    if (!(raw >= SIZING.minEdgeGrossLive)) { skipped.push({ ledgerId: c.ledgerId, reason: "edge_low" }); continue; }
    if (!c.markets.length || c.markets.some((m) => !m || m === "unmapped")) { skipped.push({ ledgerId: c.ledgerId, reason: "unmapped_market" }); continue; }
    // The read's own quarter corrects it when that quarter has a verdict; otherwise the scope does,
    // and `periodCalibration: null` is what the card has to say out loud.
    const period = periodOf(c.period);
    const slice = period ? livePeriods![period.period] : undefined;
    const pCal = calibratedProbability(c.modelProbability, c.legs, slice?.factor ?? factorLive);
    const k = shrinkFactor(c.decimal, slice?.sigmaP ?? sigmaPLive);
    const shrunk = k * grossEdge(c.decimal, pCal);
    rows.push({ candidate: c, calibratedProbability: pCal, grossEdge: raw, shrunkEdge: shrunk, k, score: growthScore(c.decimal, shrunk), period });
  }

  // A measured quarter outranks an unmeasured one, then the quarter that keeps its promise best,
  // then growth. Nothing here names a period: the ledger elects it every night.
  const sorted = [...rows].sort((a, b) =>
    Number(!!b.period) - Number(!!a.period) ||
    Math.abs(a.period?.gapPoints ?? 1) - Math.abs(b.period?.gapPoints ?? 1) ||
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
    periodCalibration: row.period,
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

  const ladderArm = mode === "carteira" && ctx.stakePolicy === "escada";
  const sized = ranked.map((row) => {
    const s = stakeUnits({
      decimal: row.candidate.decimal,
      modelProbability: row.candidate.modelProbability,
      legs: row.candidate.legs,
      c: ctx.calibration.factorPre,
      sigmaP: ctx.calibration.sigmaPPre,
      mode,
    });
    // The ladder arm is sized by the band alone, then meets exactly the same ceilings the formula
    // does. Comparing a capped policy against an uncapped one would answer a different question.
    const units = ladderArm ? Math.min(ladderUnits(row.candidate.decimal), SIZING.maxU) : s.units;
    const capped: CapKind = ladderArm ? (units < ladderUnits(row.candidate.decimal) ? "ticket" : "none") : s.capped;
    return { row, units, capped, gameId: row.candidate.gameId, players: row.candidate.players };
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
