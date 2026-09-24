import { currentSeasonParam } from "@/lib/signals/environment";
import { getTeamSeasonStats, type RankedStat, type TeamSeasonStats } from "@/lib/sources/espn-team-stats";
import { getSport } from "@/lib/sports";

/**
 * Both sides' whole season with the league rank beside every number: two requests, no model call.
 *
 * What it adds that nothing else in the pipeline has. GAME ENVIRONMENT averages each team's own
 * points for and against off its schedule, which says how this team scores and nothing about
 * whether that is fast or slow for the league it plays in. This block carries the RANK, so 96
 * points a night stops being a number and becomes first in the league or twelfth — and it carries
 * POSSESSIONS, which is the volume every counting-stat prop is a share of and which no schedule
 * read can produce.
 *
 * It is NOT a replacement for DEFENCE VS POSITION. That block answers "what does this defence
 * concede to a guard", and this endpoint publishes nothing by position — in the NBA it does not
 * publish what a team concedes at all (measured 24/09/2026). The two sit side by side on purpose.
 */

export interface TeamSeasonMatchup {
  home: TeamSeasonStats | null;
  away: TeamSeasonStats | null;
}

export async function teamSeasonForGame(args: {
  sportKey: string;
  home: { id: string; abbreviation: string };
  away: { id: string; abbreviation: string };
  startsAt: string;
  now?: Date;
}): Promise<TeamSeasonMatchup | null> {
  const sport = getSport(args.sportKey);
  if (sport.group !== "basketball") return null;
  const tipoff = new Date(args.startsAt);
  const season = currentSeasonParam(sport.key, Number.isFinite(tipoff.getTime()) ? tipoff : (args.now ?? new Date()));
  const [home, away] = await Promise.all([
    getTeamSeasonStats(sport.key, args.home.id, args.home.abbreviation, season).catch(() => null),
    getTeamSeasonStats(sport.key, args.away.id, args.away.abbreviation, season).catch(() => null),
  ]);
  return home || away ? { home, away } : null;
}

const show = (stat: RankedStat | null, unit = ""): string | null =>
  stat ? `${stat.value}${unit}${stat.rank === null ? "" : ` (#${stat.rank})`}` : null;

function describe(team: TeamSeasonStats): string {
  const parts: (string | null)[] = [
    show(team.pointsFor) && `${show(team.pointsFor)} pts`,
    show(team.pointsAgainst) && `${show(team.pointsAgainst)} conceded`,
    show(team.possessions) && `${show(team.possessions)} possessions`,
    show(team.pointsPerPossession) && `${show(team.pointsPerPossession)} pts/poss`,
    show(team.threesAttempted) && `${show(team.threesAttempted)} 3PA at ${show(team.threePointPct, "%")}`,
    show(team.rebounds) && `${show(team.rebounds)} reb`,
    show(team.assists) && `${show(team.assists)} ast`,
    show(team.turnovers) && `${show(team.turnovers)} TO`,
    show(team.steals) && `${show(team.steals)} stl`,
    show(team.blocks) && `${show(team.blocks)} blk`,
    show(team.fouls) && `${show(team.fouls)} fouls`,
  ];
  return `${team.abbreviation} (${team.games} games): ${parts.filter(Boolean).join(", ")}`;
}

export function teamSeasonPrompt(matchup: TeamSeasonMatchup | null): string {
  if (!matchup || (!matchup.home && !matchup.away)) return "TEAM SEASON RATES: not published for this matchup.";
  const rows: string[] = [
    "TEAM SEASON RATES — each side's whole season per game, with its rank in the league in brackets (#1 is the league's highest). Published by ESPN, nothing derived here:",
  ];
  for (const team of [matchup.away, matchup.home]) if (team) rows.push(`- ${describe(team)}`);
  const home = matchup.home;
  const away = matchup.away;
  if (home?.possessions && away?.possessions) {
    const pace = (home.possessions.value + away.possessions.value) / 2;
    rows.push(`- Both sides average ${pace.toFixed(1)} possessions: that is the volume every counting-stat line on this game is a share of.`);
  }
  if (home?.fouls && away?.fouls) {
    rows.push("- Fouls and turnovers set how many free throws and extra possessions the night hands out; a high-foul pair lifts free-throw and points lines on both benches.");
  }
  rows.push(
    "Ranks are the whole league over the whole season — they say what is normal, never what happens tonight. Rest, absences and the projected minutes above override them every time.",
  );
  return rows.join("\n");
}
