import { currentSeasonParam } from "@/lib/signals/environment";
import { getAthleteSplits, type AthleteSplits, type SplitLine } from "@/lib/sources/espn-splits";
import { getSport } from "@/lib/sports";

/**
 * The player's own season, cut by where tonight's game is played and by who is in front of her.
 *
 * THE SAMPLE GATE IS THE POINT OF THIS FILE. A split is a smaller sample of the same season the
 * history block already measured, so it only earns a line in the prompt when it is big enough to
 * be a fact. Measured before writing it: across the NBA feed a player's cut against one opponent
 * runs one to four games (LeBron James 2024-25: 28 opponents, median 2, none at five), so the
 * head-to-head the gate keeps out is almost every head-to-head there is — and that is the honest
 * answer to "does it look at the matchup", not a number dressed up as one. The venue cut is the
 * half that survives: thirty to forty games a side, every season.
 */

/** Below this, a cut is named as too thin and never printed as a number. Matches signals/dvp.ts. */
export const SPLIT_MIN_GAMES = 5;

export interface PlayerSplits {
  player: string;
  team: string;
  /** Where this player plays tonight. */
  venue: "home" | "road";
  season: SplitLine | null;
  /** The cut for tonight's venue, only when it cleared the gate. */
  venueLine: SplitLine | null;
  /** The other half of the season, only when it cleared the gate: the venue gap needs both. */
  otherVenueLine: SplitLine | null;
  /** Tonight's opponent, only when it cleared the gate. Almost never does — see the note above. */
  opponent: SplitLine | null;
  /** Cuts ESPN published that the gate refused, with the sample that refused them. */
  thin: { label: string; games: number }[];
}

const gate = (line: SplitLine | null, label: string, thin: { label: string; games: number }[]): SplitLine | null => {
  if (!line) return null;
  if (line.games >= SPLIT_MIN_GAMES) return line;
  thin.push({ label, games: line.games });
  return null;
};

/** Pure: one player's block out of her raw splits. Exported for the tests. */
export function playerSplitsFrom(args: {
  player: string;
  team: string;
  venue: "home" | "road";
  opponentAbbreviation: string;
  splits: AthleteSplits | null;
}): PlayerSplits | null {
  const { player, team, venue, splits } = args;
  if (!splits) return null;
  const thin: { label: string; games: number }[] = [];
  const opponentKey = args.opponentAbbreviation.toUpperCase();
  const venueLine = gate(venue === "home" ? splits.home : splits.road, venue === "home" ? "at home" : "on the road", thin);
  const otherVenueLine = gate(venue === "home" ? splits.road : splits.home, venue === "home" ? "on the road" : "at home", thin);
  const opponent = gate(splits.byOpponent[opponentKey] ?? null, `vs ${opponentKey}`, thin);
  if (!venueLine && !otherVenueLine && !opponent && !thin.length) return null;
  return { player, team, venue, season: splits.overall, venueLine, otherVenueLine, opponent, thin };
}

export interface SplitTarget {
  athleteId: string;
  player: string;
  /** The team abbreviation this player belongs to, as the props carry it. */
  team: string;
}

/**
 * One cached request per player, at most `limit` of them, and no model call. Never throws: a player
 * whose feed is missing or shelled simply produces nothing.
 */
export async function splitsForGame(args: {
  sportKey: string;
  homeAbbreviation: string;
  awayAbbreviation: string;
  startsAt: string;
  targets: SplitTarget[];
  limit?: number;
  now?: Date;
}): Promise<PlayerSplits[]> {
  const sport = getSport(args.sportKey);
  if (sport.group !== "basketball") return [];
  const tipoff = new Date(args.startsAt);
  const season = currentSeasonParam(sport.key, Number.isFinite(tipoff.getTime()) ? tipoff : (args.now ?? new Date()));
  const seen = new Set<string>();
  const targets = args.targets
    .filter((t) => t.athleteId && !seen.has(t.athleteId) && (seen.add(t.athleteId), true))
    .slice(0, args.limit ?? 10);

  const rows = await Promise.all(
    targets.map(async (target) => {
      const home = target.team === args.homeAbbreviation;
      const splits = await getAthleteSplits(sport.key, target.athleteId, season).catch(() => null);
      return playerSplitsFrom({
        player: target.player,
        team: target.team,
        venue: home ? "home" : "road",
        opponentAbbreviation: home ? args.awayAbbreviation : args.homeAbbreviation,
        splits,
      });
    }),
  );
  return rows.filter((r): r is PlayerSplits => r !== null);
}

const per = (line: SplitLine) => `${line.points ?? "?"} pts / ${line.rebounds ?? "?"} reb / ${line.assists ?? "?"} ast${line.threes === null ? "" : ` / ${line.threes} 3pm`} in ${line.games} g`;
const signed = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}`;

export function splitsPrompt(rows: PlayerSplits[]): string {
  if (!rows.length) return "PLAYER SPLITS: not published for this league.";
  const lines: string[] = [
    `PLAYER SPLITS — the same player cut by where tonight's game is played and by who is in front of her, as ESPN publishes it. A cut under ${SPLIT_MIN_GAMES} games is named below as too thin and is NOT a fact you may use:`,
  ];
  for (const row of rows) {
    const where = row.venue === "home" ? "at home tonight" : "on the road tonight";
    const parts: string[] = [];
    if (row.season) parts.push(`season ${per(row.season)}`);
    if (row.venueLine) parts.push(`${row.venue === "home" ? "at home" : "on the road"} ${per(row.venueLine)}`);
    if (row.otherVenueLine) parts.push(`${row.venue === "home" ? "on the road" : "at home"} ${per(row.otherVenueLine)}`);
    if (row.venueLine && row.otherVenueLine && row.venueLine.points !== null && row.otherVenueLine.points !== null) {
      parts.push(`venue gap ${signed(row.venueLine.points - row.otherVenueLine.points)} pts in the direction of tonight`);
    }
    if (row.opponent) parts.push(`vs this opponent ${per(row.opponent)}`);
    if (row.thin.length) parts.push(`insufficient sample, not used: ${row.thin.map((t) => `${t.label} (${t.games} g)`).join(", ")}`);
    if (!parts.length) continue;
    lines.push(`- ${row.player} (${row.team}, ${where}): ${parts.join("; ")}`);
  }
  if (lines.length === 1) return "PLAYER SPLITS: not published for this league.";
  lines.push(
    "A venue gap is a tendency, not a projection, and part of it is already inside the minutes and role blocks above — use it to lean, never to set a number.",
    "Never state a head-to-head record against tonight's opponent that is not printed above: where it says insufficient sample there is no measured matchup, and saying one anyway is inventing it.",
  );
  return lines.join("\n");
}
