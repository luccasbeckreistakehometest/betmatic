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
  rosters: { teamAbbreviation: string; players: string[]; athletes?: { name: string; id: string }[] }[];
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
}

export type LegOutcome = "won" | "lost" | "push" | "void" | "pending";

export interface SettledLeg {
  selection: string;
  market: string;
  sourceBasis: string;
  /** Kept so grading is deterministic rather than a re-parse of the prose. */
  settlement?: Settlement;
  predictedProbability: number;
  oddsDecimal: number;
  outcome: LegOutcome;
  actual?: string;
}

export interface LedgerEntry {
  id: string;
  gameId: string;
  sportKey: string;
  matchup: string;
  createdAt: string;
  settledAt?: string;
  bandKey: string;
  kind: "single" | "parlay";
  title: string;
  combinedDecimal: number;
  modelledProbability: number;
  /** The generator's 0–100 evidence score at creation; absent on tickets logged before it was recorded. */
  evidenceScore?: number;
  legs: SettledLeg[];
  outcome: LegOutcome;
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
}

export interface CalibrationReport {
  totalSettled: number;
  bySource: CalibrationRow[];
  byMarket: CalibrationRow[];
  bySport: CalibrationRow[];
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
  riskNote: string;
  /** The model's own read. */
  confidence: "high" | "medium" | "low";
  /** Computed from the evidence actually behind the legs, 0-100. Independent of the model's claim. */
  evidenceScore: number;
  evidenceNotes: string[];
  /** Id of the ticket this one is a fallback for. Markets close; a reader needs a second door. */
  alternativeFor?: string;
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
