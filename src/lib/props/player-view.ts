import { gameTotal } from "@/lib/props/rates";
import type { MarketDef } from "@/lib/sports";
import type { PlayerGame } from "@/lib/types";

/**
 * The player deep dive as the page receives it. Client-safe: no server imports. Numbers are all
 * computed from ESPN's game logs and posted prices; the only prose is the optional analyst read.
 */
export interface PostedLineView {
  marketKey: string;
  line: number;
  side: "over" | "under";
  decimal: number;
  openDecimal: number | null;
  noVigFair: number | null;
  kind: "total" | "milestone" | "yes";
}

export interface PlayerMarketView {
  key: string;
  label: { pt: string; en: string };
  statLabels: string[];
  binary: boolean;
  defaultLine: number;
  posted: PostedLineView[];
}

export interface DvpView {
  position: string;
  opponent: string;
  /** What tonight's opponent concedes per game to this position bucket. */
  opponentConcedes: { points: number; rebounds: number; assists: number; threes: number };
  /** The same measure for the player's own team, as a reference point. */
  ownConcedes: { points: number; rebounds: number; assists: number; threes: number } | null;
  games: number;
}

export interface RoleView {
  tier: "starter" | "rotation" | "fringe" | "unknown";
  minutesPerGame: number | null;
  recentMinutes: number | null;
  minutesTrend: number;
  reliability: number;
  games: number;
  note: string;
}

export interface PlayerProfileView {
  athleteId: string;
  sportKey: string;
  sportGroup: "basketball" | "soccer";
  name: string;
  teamAbbr: string;
  position: string | null;
  game: { id: string; matchup: string; startsAt: string; opponentAbbr: string; status: string } | null;
  /** Newest first; stats limited to what the markets and the minutes chart need. */
  games: PlayerGame[];
  markets: PlayerMarketView[];
  role: RoleView | null;
  dvp: DvpView | null;
  teammates: { id: string; name: string }[];
  /** Whether the game log carries minutes (basketball) — the "com/sem" split reads them. */
  usesMinutes: boolean;
  generatedAt: string;
}

/** Half-point lines around the median cannot push, which is how books price them. */
export function defaultLineFor(games: Pick<PlayerGame, "stats">[], market: Pick<MarketDef, "statLabels" | "binary">): number {
  if (market.binary) return 0.5;
  const values = games.map((g) => gameTotal(g, market.statLabels)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return 0.5;
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  return Math.max(0.5, Math.round(median) - 0.5);
}

/** The line a slider can reach: from 0.5 to a bit past the player's best game, on half points. */
export function lineRange(games: Pick<PlayerGame, "stats">[], statLabels: string[]): { min: number; max: number } {
  const values = games.map((g) => gameTotal(g, statLabels)).filter(Number.isFinite);
  const top = values.length ? Math.max(...values) : 10;
  return { min: 0.5, max: Math.max(1.5, Math.ceil(top) + 0.5) };
}
