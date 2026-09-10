// Shared domain types for the NBA betting research dashboard.

export type GameStatus = "scheduled" | "live" | "final";

export interface TeamRef {
  id: string;
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
  rosters: { teamAbbreviation: string; players: string[] }[];
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
  brief: SourceResult<GameBrief>;
}
