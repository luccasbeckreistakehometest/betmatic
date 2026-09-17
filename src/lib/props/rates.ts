import type { PlayerGame } from "@/lib/types";

/**
 * Hit rates at any line, computed the same way as measureProp (a value exactly on the line is a push
 * and counts for neither side). Client-safe: the player page recomputes these as the line is dragged.
 */
export function statValue(game: Pick<PlayerGame, "stats">, label: string): number {
  const raw = game.stats[label];
  if (raw === undefined) return NaN;
  if (typeof raw === "number") return raw;
  const made = String(raw).match(/^(\d+(?:\.\d+)?)-/);
  if (made) return Number(made[1]);
  const num = Number(raw);
  return Number.isFinite(num) ? num : NaN;
}

export function gameTotal(game: Pick<PlayerGame, "stats">, labels: string[]): number {
  let sum = 0;
  for (const label of labels) {
    const v = statValue(game, label);
    if (!Number.isFinite(v)) return NaN;
    sum += v;
  }
  return sum;
}

export interface Rate { hits: number; of: number; pct: number }

export function rateAt(values: number[], line: number, side: "over" | "under" = "over"): Rate {
  const decided = values.filter((v) => Number.isFinite(v) && v !== line);
  const hits = decided.filter((v) => (side === "over" ? v > line : v < line)).length;
  return { hits, of: decided.length, pct: decided.length ? hits / decided.length : NaN };
}

export interface RateTable { last5: Rate; last10: Rate; season: Rate; home: Rate; away: Rate }

/** `games` newest first, as the game log is stored. */
export function rateTable(games: Pick<PlayerGame, "stats" | "homeAway">[], labels: string[], line: number, side: "over" | "under" = "over"): RateTable {
  const rows = games.map((g) => ({ v: gameTotal(g, labels), where: g.homeAway })).filter((r) => Number.isFinite(r.v));
  const vals = rows.map((r) => r.v);
  return {
    last5: rateAt(vals.slice(0, 5), line, side),
    last10: rateAt(vals.slice(0, 10), line, side),
    season: rateAt(vals, line, side),
    home: rateAt(rows.filter((r) => r.where === "vs").map((r) => r.v), line, side),
    away: rateAt(rows.filter((r) => r.where === "@").map((r) => r.v), line, side),
  };
}

export const MIN_SPLIT_GAMES = 3;

export interface Split { with: Rate; without: Rate; withGames: number; withoutGames: number; enough: boolean }

/**
 * "Com e sem o companheiro": the player's games split by whether the teammate played. A teammate
 * played when his log has the same event with minutes (basketball) or at all (football, which logs
 * no minutes). Small samples are flagged, never presented as a signal on their own.
 */
export function splitWithWithout(
  player: Pick<PlayerGame, "eventId" | "stats">[],
  teammate: Pick<PlayerGame, "eventId" | "stats">[],
  labels: string[],
  line: number,
  side: "over" | "under",
  usesMinutes: boolean,
): Split {
  const played = new Set(teammate.filter((g) => !usesMinutes || statValue(g, "MIN") > 0).map((g) => g.eventId));
  const withVals: number[] = [];
  const withoutVals: number[] = [];
  for (const g of player) {
    const v = gameTotal(g, labels);
    if (!Number.isFinite(v)) continue;
    (played.has(g.eventId) ? withVals : withoutVals).push(v);
  }
  return {
    with: rateAt(withVals, line, side),
    without: rateAt(withoutVals, line, side),
    withGames: withVals.length,
    withoutGames: withoutVals.length,
    enough: withVals.length >= MIN_SPLIT_GAMES && withoutVals.length >= MIN_SPLIT_GAMES,
  };
}
