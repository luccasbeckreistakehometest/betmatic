import { cached } from "@/lib/cache";
import { getSport } from "@/lib/sports";
import { espnJson, type Json } from "@/lib/sources/espn-http";

/**
 * A team's whole season in one request, with the league rank beside every number.
 *
 * signals/environment.ts already averages points for and against off the schedule, and signals/
 * dvp.ts already walks fifteen box scores per side. Neither of them can produce what this endpoint
 * ships for free: POSSESSIONS (the count every counting-stat prop is really a share of) and the
 * RANK — the only thing that says whether 96 points a night is fast or slow for this league, which
 * no single team's own schedule can ever tell you. It answers a plain client, no token, no
 * challenge (probed 24/09/2026), which is the bar sources/br-books/registry.ts sets.
 *
 * MEASURED, and it decides what the prompt may claim: the WNBA publishes `avgPointsAllowed`, the
 * NBA does NOT (Denver 2025-26: 82 games, avgPoints 116.3, avgEstimatedPossessions 99.4,
 * avgPointsAllowed absent). So the conceded side is read where it exists and left out where it does
 * not, rather than back-filled off the schedule and printed as if it came from the same row.
 */
const CORE = "https://sports.core.api.espn.com/v2/sports";
/** A season aggregate moves once per game; half a day is fresh and costs one request per team. */
const TTL = 12 * 60 * 60_000;

/** A published stat with the league rank ESPN puts beside it. */
export interface RankedStat {
  value: number;
  /** 1 is the top of the league. Absent for the stats ESPN does not rank. */
  rank: number | null;
}

export interface TeamSeasonStats {
  teamId: string;
  abbreviation: string;
  season: number;
  games: number;
  pointsFor: RankedStat | null;
  /** WNBA only: the NBA feed does not publish it. Never derived. */
  pointsAgainst: RankedStat | null;
  /** Estimated possessions per game — the volume every counting-stat prop is a share of. */
  possessions: RankedStat | null;
  pointsPerPossession: RankedStat | null;
  threesAttempted: RankedStat | null;
  threePointPct: RankedStat | null;
  assists: RankedStat | null;
  rebounds: RankedStat | null;
  turnovers: RankedStat | null;
  /** What the defence generates rather than what it concedes: steals and blocks per game. */
  steals: RankedStat | null;
  blocks: RankedStat | null;
  fouls: RankedStat | null;
}

/** A team needs a real season behind it before any of its rates mean anything. */
export const TEAM_STATS_MIN_GAMES = 5;

function collect(data: Json): Map<string, RankedStat> {
  const out = new Map<string, RankedStat>();
  const categories: Json[] = Array.isArray(data?.splits?.categories) ? data.splits.categories : [];
  for (const category of categories) {
    for (const stat of (Array.isArray(category.stats) ? category.stats : []) as Json[]) {
      const name = String(stat.name ?? "");
      const value = Number(stat.value);
      if (!name || !Number.isFinite(value)) continue;
      const rank = Number(stat.rank);
      // Categories can repeat a name (`rebounds` sits in general and defensive); first one wins.
      if (!out.has(name)) out.set(name, { value: Number(value.toFixed(2)), rank: Number.isFinite(rank) ? rank : null });
    }
  }
  return out;
}

/** Pure: the season line out of one raw payload. Exported for the tests. */
export function parseTeamSeasonStats(data: Json, teamId: string, abbreviation: string, season: number): TeamSeasonStats | null {
  const stats = collect(data);
  const games = stats.get("gamesPlayed")?.value ?? 0;
  if (games < TEAM_STATS_MIN_GAMES) return null;
  const pick = (name: string) => stats.get(name) ?? null;
  return {
    teamId,
    abbreviation,
    season,
    games,
    pointsFor: pick("avgPoints"),
    pointsAgainst: pick("avgPointsAllowed"),
    possessions: pick("avgEstimatedPossessions"),
    pointsPerPossession: pick("pointsPerEstimatedPossessions"),
    threesAttempted: pick("avgThreePointFieldGoalsAttempted"),
    threePointPct: pick("threePointPct"),
    assists: pick("avgAssists"),
    rebounds: pick("avgRebounds"),
    turnovers: pick("avgTurnovers"),
    steals: pick("avgSteals"),
    blocks: pick("avgBlocks"),
    fouls: pick("avgFouls"),
  };
}

/** One cached request per team. Never throws: a missing feed leaves the caller with nothing to say. */
export async function getTeamSeasonStats(sportKey: string, teamId: string, abbreviation: string, season: number): Promise<TeamSeasonStats | null> {
  const sport = getSport(sportKey);
  if (sport.group !== "basketball" || !teamId) return null;
  return cached(`team-season-${sport.key}-${teamId}-${season}`, TTL, async () => {
    try {
      // types/2 is the regular season; the pre-season and the playoffs are their own aggregates.
      const url = `${CORE}/${sport.espnSport}/leagues/${sport.espnLeague}/seasons/${season}/types/2/teams/${teamId}/statistics`;
      return parseTeamSeasonStats(await espnJson(url, { timeoutMs: 6000 }), teamId, abbreviation, season);
    } catch {
      return null;
    }
  });
}
