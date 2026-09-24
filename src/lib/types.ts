// Shared domain types for the NBA betting research dashboard.

export type GameStatus = "scheduled" | "live" | "final";

/** Represents a team in team sports and a single player in tennis. */
export interface TeamRef {
  id: string;
  athleteId?: string;
  country?: string;
  abbreviation: string;
  name: string;
  displayName: string;
  logo?: string;
  color?: string;
  record?: string;
  score?: number;
}

export interface OddsLine {
  provider?: string;
  details?: string;
  spread?: number;
  overUnder?: number;
  homeMoneyline?: number;
  awayMoneyline?: number;
  homeSpreadOdds?: number;
  awaySpreadOdds?: number;
  overOdds?: number;
  underOdds?: number;
}

export interface Game {
  id: string;
  sportKey: string;
  /** Tennis: the tournament and round this match belongs to. */
  tournament?: string;
  round?: string;
  startsAt: string;
  status: GameStatus;
  statusDetail: string;
  home: TeamRef;
  away: TeamRef;
  venue?: string;
  broadcast?: string;
  odds?: OddsLine;
}

export interface InjuryEntry {
  teamAbbreviation: string;
  player: string;
  position?: string;
  status: string;
  detail?: string;
  updatedAt?: string;
}

export interface TeamStatLine {
  label: string;
  value: string;
  rank?: string;
}

export interface GameDetail {
  game: Game;
  injuries: InjuryEntry[];
  teamStats: { home: TeamStatLine[]; away: TeamStatLine[] };
  predictor?: { homeWinPct?: number; awayWinPct?: number };
  books: OddsLine[];
  ats: { teamAbbreviation: string; record: string }[];
  leaders: { teamAbbreviation: string; player: string; line: string }[];
  lastMeetings: { date: string; summary: string }[];
  rosters: { teamAbbreviation: string; players: string[]; athletes?: { name: string; id: string; position?: string }[] }[];
}

export interface Tweet {
  id: string;
  handle: string;
  authorName?: string;
  text: string;
  postedAt?: string;
  url: string;
  tier?: string;
}

export interface XIntelItem {
  tweetId: string;
  handle: string;
  url: string;
  postedAt?: string;
  text: string;
  relevance: "high" | "medium" | "low";
  category: "injury" | "lineup" | "rotation" | "trade" | "rest" | "betting" | "other";
  playersMentioned: string[];
  teamsMentioned: string[];
  bettingImpact: string;
}

export interface XIntel {
  summary: string;
  items: XIntelItem[];
  scanned: number;
}

export interface PlayerGame {
  eventId: string;
  date: string;
  opponent: string;
  homeAway: "vs" | "@" | "";
  result: string;
  stats: Record<string, number | string>;
}

export interface PlayerHistory {
  athleteId: string;
  player: string;
  team: string;
  games: PlayerGame[];
  availableStats: string[];
}

/** Measured hit rate of a prop line against real game logs. */
export interface HitRate {
  stat: string;
  line: number;
  side: "over" | "under";
  last5: { hits: number; of: number };
  last10: { hits: number; of: number };
  season: { hits: number; of: number };
  average: number;
  median: number;
  /** Season hit rate as a probability, used as the fair-price input. */
  impliedFair: number;
  sampleNote: string;
}

/** One rung of a prop ladder with its computed probability. */
export interface LadderProbability { line: number; pOver: number; pUnder: number }

/**
 * The computed probability of a prop line (props/model.ts): a fitted per-minute rate over projected
 * minutes, blended with the season hit rate. Attached in code, never by the model.
 */
export interface PropModel {
  /** P(the posted side lands), the number fairProbability anchors to. */
  computed: number;
  /** The fitted distribution's own tail, before the blend with the hit rate. */
  distribution: number;
  pOver: number;
  pUnder: number;
  mean: number;
  sd: number;
  rate: number;
  recentRate: number;
  dispersion: number;
  minutes: { expected: number; sd: number; availability: "ok" | "questionable" | "listed_out" };
  ladder: LadderProbability[];
  /** One line of arithmetic: "0.62/min × 30 ± 4 min → 18.7 ± 6.4". */
  note: string;
  /** In play: what the line still needs per remaining minute against the rate produced tonight. */
  live?: {
    needed: number;
    remainingMinutes: number;
    needPerMinute: number;
    ratePerMinuteTonight: number;
    ratePerMinutePreGame: number;
    /** The rate the remainder is priced at: the pre-game rate (tonight's does not forecast the rest; see props/model.ts liveRate). */
    ratePerMinuteBlended: number;
    minutesPlayed: number;
    fouls: number;
  };
}

/** A minutes projection as the prompt prints it (props/minutes.ts builds it). */
export interface MinutesView {
  player: string;
  expected: number;
  sd: number;
  availability: "ok" | "questionable" | "listed_out";
  note: string;
}

export interface PropRow {
  player: string;
  team?: string;
  market: string;
  line?: number;
  side?: "over" | "under" | "yes" | "no" | "unknown";
  odds?: string;
  book?: string;
  projection?: number;
  edgePct?: number;
  hitRate?: string;
  note?: string;
  /** Computed from ESPN game logs, independent of whatever the source tool claimed. */
  measured?: HitRate | null;
  athleteId?: string;
  /** MarketDef.key within the sport. */
  marketKey?: string;
  /** The posted decimal price at this exact line; absent on an unpriced candidate. */
  decimal?: number;
  /** The price the book opened this line at, when it has not moved the line since. */
  openDecimal?: number | null;
  /** The side's chance with the book margin removed (two-sided markets only). */
  noVigFair?: number | null;
  priced?: boolean;
  /**
   * Set only while the game is in progress: what the player already has, what the line still needs
   * and how much of regulation is left. Legs the box score has already decided never get here.
   */
  live?: { current: number; remaining: number; minutesLeft: number } | null;
  /**
   * Set when a Brazilian book posts THIS exact line on its in-play feed and the collector read it
   * inside the freshness window: the price above is that one, and it is a price a reader could take
   * right now. Absent means the row's price is still the pre-game reference ESPN posted before the
   * tip — the distinction the whole live scope's honesty rests on, so it is carried per row rather
   * than assumed for the read.
   */
  livePrice?: { book: string; decimal: number; fetchedAt: string } | null;
  /** Computed probability for this exact line and side, with the minutes and rate behind it. */
  model?: PropModel | null;
  /** Per-game values of this market, newest first, for measured co-occurrence between legs. */
  series?: { eventId?: string; value: number; minutes: number }[];
  /** The projected minutes for this player, shared by every row on her. */
  minutesProjection?: MinutesView | null;
}

export interface PickRow {
  label: string;
  market: string;
  selection: string;
  odds?: string;
  book?: string;
  confidence?: string;
  rationale?: string;
}

export interface ScrapeCapture {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  tables: string[];
  apiPayloads: { url: string; body: string }[];
  screenshotBase64?: string;
  loggedIn: boolean;
}

export type SourceStatus = "ok" | "empty" | "needs-login" | "disabled" | "error";

export interface SourceResult<T> {
  source: string;
  status: SourceStatus;
  data: T | null;
  error?: string;
  fetchedAt: string;
  meta?: Record<string, unknown>;
}

/** Everything needed to grade a leg automatically once the game is final. */
export interface Settlement {
  type: "moneyline" | "spread" | "total" | "player_prop" | "other";
  teamAbbreviation?: string;
  player?: string;
  stat?: string;
  line?: number;
  side?: "over" | "under" | "home" | "away" | "yes" | "no";
  /** Which gathered source the leg leaned on, so calibration can be attributed. */
  sourceBasis: string;
}

export interface BetLeg {
  selection: string;
  market: string;
  odds: string;
  oddsDecimal: number;
  book?: string;
  /** Why this leg, grounded in gathered data. */
  explanation: string;
  /** Measured support: hit rate, injury status, insider report. */
  evidence: string;
  fairProbability: number;
  settlement?: Settlement;
  /** For cross-game tickets: the game this leg belongs to. */
  gameId?: string;
  /** ESPN athlete id for player legs — links the leg to the player deep dive. */
  athleteId?: string;
  /** The book's opening price for this line, when it is known and the line has not moved. */
  openOdds?: number;
  /** Measured record at this exact line, attached in code (never by the model). */
  measured?: { last5: string; last10: string; season: string; rate: number };
  /** The computed probability of the line (props/model.ts) at generation time; absent when no model covered it. */
  computedProbability?: number;
  /** The arithmetic behind computedProbability, for the reader. */
  modelNote?: string;
  /** The model's own estimate before it was anchored to computedProbability; the ledger races the two. */
  rawProbability?: number;
  /** Minutes the projection gives this player — the number every counting-stat leg stands on. */
  projectedMinutes?: number;
}

export type LegOutcome = "won" | "lost" | "push" | "void" | "pending";

export interface SettledLeg {
  selection: string;
  market: string;
  sourceBasis: string;
  /** Kept so grading is deterministic rather than a re-parse of the prose. */
  settlement?: Settlement;
  predictedProbability: number;
  /** What the deterministic model said at generation time, kept beside the model's own number so the two can be compared once settled. */
  computedProbability?: number;
  /** The language model's estimate before anchoring; predictedProbability is the anchored number the ticket was served with. */
  rawProbability?: number;
  oddsDecimal: number;
  /**
   * The price of this selection at the minute the live read was taken, once there is one to record.
   * `oddsDecimal` on a live leg is the PRE-GAME board, which is why the live reads publish no
   * return; collecting the in-play price is the epic that closes that question, and the field is
   * here so the ledger written today can already carry it.
   */
  liveDecimal?: number;
  outcome: LegOutcome;
  actual?: string;
  /*
   * Copied from the generation payload so a slice of the ledger can be cut by something other than
   * the price. All optional: a row written before they existed reads exactly as it did before.
   */
  athleteId?: string;
  /** The canonical market key at the time of writing (ledger/stat-key.ts). */
  marketKey?: string;
  /** Season hit rate measured at this exact line, from the game log. */
  measuredRate?: number;
  projectedMinutes?: number;
  /** The game's own context at generation time, the same for every leg of the ticket. */
  blowoutProbability?: number;
  paceDelta?: number;
  modelNote?: string;
}

export interface LedgerEntry {
  id: string;
  gameId: string;
  sportKey: string;
  matchup: string;
  createdAt: string;
  settledAt?: string;
  /**
   * Kickoff of the ticket's game (the latest one for a cross-game ticket). Until then the ticket is
   * paid content and stays out of every public view; absent on tickets logged before it was recorded.
   */
  startsAt?: string;
  bandKey: string;
  kind: "single" | "parlay";
  title: string;
  combinedDecimal: number;
  modelledProbability: number;
  /** The generator's 0–100 evidence score at creation; absent on tickets logged before it was recorded. */
  evidenceScore?: number;
  /**
   * The generator's own confidence in this ticket, filed here rather than only inside the stored
   * slate. The slate keeps one row per game and language and is OVERWRITTEN when a game is
   * regenerated: on 22/09/2026 game 401857209 was rebuilt at 23:57 and took the suggestion ids of
   * twelve already-served tickets with it, so their confidence became unrecoverable — and it is a
   * selection cut, not decoration. The ledger is append-only, so a copy here survives regeneration.
   * Absent on tickets logged before this was recorded.
   */
  confidence?: string;
  /** The suggestion id inside its stored slate (links alerts and prices to the served ticket). */
  suggestionId?: string;
  /** Ledger id of the main ticket this one backs up. The public record counts main tickets by default. */
  alternativeOf?: string;
  /**
   * `live` marks a ticket built while the game was in play. Absent on every pre-game ticket.
   */
  scope?: "live";
  /**
   * `live_book` marks a live ticket EVERY leg of which was priced from a Brazilian book's own
   * in-play feed, read seconds before the ticket was written — so its return is collectable and it
   * is the only live population that may carry one. A live ticket without it was priced off the
   * pre-game board, which by the third quarter is a price nobody could take; it is graded and
   * measured like any other read and never contributes a unit.
   *
   * It is written once, at generation time, and never backfilled: the ledger is append-only and no
   * number this product has already published may become collectable after the fact.
   */
  priceBasis?: "live_book";
  /** Regulation minute the live read was taken at. */
  minute?: number;
  /** Period (quarter) the live read was taken in — basketball reads are taken at every quarter break. */
  period?: number;
  /**
   * Minutes of the period still on the clock when the read was taken. It is what makes "chance
   * 1,000 because the clock had run out" visible in the ledger instead of having to be inferred:
   * every live entry before this field was recorded has `minute` at exactly 10, 20, 30 or 40.
   */
  clockLeft?: number;
  /**
   * The same-game correlation factor already applied to `modelledProbability`
   * (BetSuggestion.correlation.factor). Without it the ticket's own price cannot be rebuilt from
   * its legs, so a ticket with a voided leg cannot be re-priced on the survivors.
   */
  correlationFactor?: number;
  legs: SettledLeg[];
  outcome: LegOutcome;
  /*
   * What produced this ticket. All optional and all written at generation time, so a before/after
   * is a query rather than an argument: which prompt version wrote it, which model, who asked, and
   * which version of the selection policy was live when it was written.
   */
  promptVersion?: string;
  modelId?: string;
  generatedBy?: string;
  policyVersion?: string;
}

/** Measured track record for one slice of predictions. */
export interface CalibrationRow {
  key: string;
  label: string;
  settled: number;
  won: number;
  hitRate: number;
  averagePredicted: number;
  /** predicted minus actual: positive means the model was overconfident. */
  calibrationError: number;
  /**
   * The Platt map fitted to this slice's own legs (ledger/platt.ts): `σ(slope·logit(p) + intercept)`.
   * A slope below 1 means the slice's error GROWS with the claim, which one average shift cannot fix.
   * Unshrunk here — `recalibrate.ts` applies the sample-size weight, so the report shows what the
   * legs said and the correction shows what the product dares act on.
   */
  fit?: { slope: number; intercept: number; spread: number; interceptOnly: boolean };
}

export interface CalibrationReport {
  totalSettled: number;
  bySource: CalibrationRow[];
  byMarket: CalibrationRow[];
  /** The same legs cut by canonical market key (stat-key.ts) — finer than `market`. */
  byStat: CalibrationRow[];
  bySport: CalibrationRow[];
  /** over vs under. `under` ran 20 points optimistic over 506 legs and nothing showed it. */
  bySide: CalibrationRow[];
  generatedAt: string;
}

export interface BetSuggestion {
  id: string;
  kind: "single" | "parlay";
  bandKey: string;
  title: string;
  /** Context for the whole ticket: what situation makes this worth looking at. */
  background: string;
  legs: BetLeg[];
  combinedDecimal: number;
  combinedAmerican: string;
  impliedProbability: number;
  modelledProbability: number;
  edgePct: number;
  /** Same-game correlation applied to the product of the leg probabilities (signals/correlation.ts). */
  correlation?: { factor: number; independentProbability: number; note: string };
  riskNote: string;
  /** The model's own read. */
  confidence: "high" | "medium" | "low";
  /** Computed from the evidence actually behind the legs, 0-100. Independent of the model's claim. */
  evidenceScore: number;
  evidenceNotes: string[];
  /** Id of the ticket this one is a fallback for. Markets close; a reader needs a second door. */
  alternativeFor?: string;
  /** When to switch to this alternative ("se o Fulano for vetado"). */
  swapReason?: string;
}

export interface BetSlate {
  suggestions: BetSuggestion[];
  dataNote: string;
}

export interface GameBrief {
  headline: string;
  keyAngles: { angle: string; support: string; confidence: "high" | "medium" | "low" }[];
  injuryWatch: string[];
  conflicts: string[];
  missingData: string[];
  disclaimer: string;
}

export interface GameIntel {
  game: Game;
  detail: GameDetail | null;
  x: SourceResult<XIntel>;
  propscash: SourceResult<{ props: PropRow[]; notes: string[] }>;
  mamaKnowsBets: SourceResult<{ picks: PickRow[]; notes: string[] }>;
  dimers: SourceResult<{ picks: PickRow[]; notes: string[] }>;
  bets: SourceResult<BetSlate>;
  brief: SourceResult<GameBrief>;
}
