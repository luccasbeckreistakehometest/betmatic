import { cached } from "@/lib/cache";
import { getSport } from "@/lib/sports";

const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const TTL = { dvp: 12 * 60 * 60_000 };

/** Coarse buckets are all ESPN publishes, and all DvP is normally cut by anyway. */
export type PosBucket = "G" | "F" | "C";

export interface DvpLine {
  position: PosBucket;
  /** Per-game totals conceded to opposing players in this bucket. */
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
  sample: number;
}

export interface DvpProfile {
  teamAbbreviation: string;
  games: number;
  lines: DvpLine[];
}

// ESPN box scores are deeply nested and undocumented; every access below is optional-chained.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function getJson(url: string): Promise<Json | null> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    return res.ok ? ((await res.json()) as Json) : null;
  } catch {
    return null;
  }
}

function bucket(abbrev: string | undefined): PosBucket | null {
  if (!abbrev) return null;
  const a = abbrev.toUpperCase();
  if (a.startsWith("G")) return "G";
  if (a.startsWith("F")) return "F";
  if (a.startsWith("C")) return "C";
  return null;
}

function madeOf(value: string | undefined): number {
  if (!value) return 0;
  const m = value.match(/^(\d+)-/);
  return m ? Number(m[1]) : Number(value) || 0;
}

/**
 * Defense vs Position: what a team concedes to each position bucket, averaged per game.
 *
 * This is the version of "player vs team" that survives scrutiny — it aggregates the defence across
 * a whole sample of opponents rather than the handful of times one player faced them, so it is not
 * the small-sample trap that a player's personal record against a team is.
 */
export async function computeDvp(
  sportKey: string,
  teamId: string,
  teamAbbreviation: string,
  sampleGames = 15,
  season = 2026,
): Promise<DvpProfile | null> {
  const sport = getSport(sportKey);
  if (sport.group !== "basketball" || !teamId) return null;
  const base = `${SITE}/${sport.espnSport}/${sport.espnLeague}`;

  return cached(`dvp-${sport.key}-${teamId}-${season}-${sampleGames}`, TTL.dvp, async () => {
    const schedule = await getJson(`${base}/teams/${teamId}/schedule?season=${season}`);
    const completed = ((schedule?.events ?? []) as Json[])
      .filter((e) => e.competitions?.[0]?.status?.type?.completed)
      .slice(-sampleGames);
    if (completed.length < 5) return null;

    const totals: Record<PosBucket, { pts: number; reb: number; ast: number; tpm: number; n: number }> = {
      G: { pts: 0, reb: 0, ast: 0, tpm: 0, n: 0 },
      F: { pts: 0, reb: 0, ast: 0, tpm: 0, n: 0 },
      C: { pts: 0, reb: 0, ast: 0, tpm: 0, n: 0 },
    };
    let counted = 0;

    for (const event of completed) {
      const summary = await getJson(`${base}/summary?event=${event.id}`);
      const groups = (summary?.boxscore?.players ?? []) as Json[];
      // Only the other team's line counts: DvP measures what this defence conceded.
      const opponent = groups.find((g) => g.team?.abbreviation !== teamAbbreviation);
      const stat = opponent?.statistics?.[0];
      if (!stat) continue;

      const labels: string[] = stat.labels ?? [];
      const idx = (label: string) => labels.indexOf(label);
      const iPts = idx("PTS");
      const iReb = idx("REB");
      const iAst = idx("AST");
      const i3 = idx("3PT");
      if (iPts < 0) continue;

      for (const athlete of (stat.athletes ?? []) as Json[]) {
        const pos = bucket(athlete.athlete?.position?.abbreviation);
        if (!pos) continue;
        const stats: string[] = athlete.stats ?? [];
        if (!stats.length) continue;
        totals[pos].pts += Number(stats[iPts]) || 0;
        totals[pos].reb += iReb >= 0 ? Number(stats[iReb]) || 0 : 0;
        totals[pos].ast += iAst >= 0 ? Number(stats[iAst]) || 0 : 0;
        totals[pos].tpm += i3 >= 0 ? madeOf(stats[i3]) : 0;
      }
      for (const key of ["G", "F", "C"] as PosBucket[]) totals[key].n += 1;
      counted += 1;
    }

    if (counted < 5) return null;

    return {
      teamAbbreviation,
      games: counted,
      lines: (["G", "F", "C"] as PosBucket[]).map((position) => ({
        position,
        points: Number((totals[position].pts / counted).toFixed(1)),
        rebounds: Number((totals[position].reb / counted).toFixed(1)),
        assists: Number((totals[position].ast / counted).toFixed(1)),
        threes: Number((totals[position].tpm / counted).toFixed(1)),
        sample: counted,
      })),
    };
  });
}

/**
 * Compares the two defences in a matchup. No league baseline is needed: each side's concession is
 * meaningful relative to the other, and a gap between them is what a prop leg can lean on.
 */
export function dvpPrompt(home: DvpProfile | null, away: DvpProfile | null): string {
  if (!home && !away) return "DEFENCE VS POSITION: not computed for this matchup.";
  const rows: string[] = [
    "DEFENCE VS POSITION — per-game totals each defence concedes to opposing players, by position bucket:",
  ];
  for (const profile of [home, away]) {
    if (!profile) continue;
    rows.push(
      `- ${profile.teamAbbreviation} (last ${profile.games} games): ` +
        profile.lines
          .map((l) => `${l.position} ${l.points}pts/${l.rebounds}reb/${l.assists}ast/${l.threes}3pm`)
          .join(" · "),
    );
  }
  if (home && away) {
    const gaps = (["G", "F", "C"] as PosBucket[]).map((position) => {
      const h = home.lines.find((l) => l.position === position)!;
      const a = away.lines.find((l) => l.position === position)!;
      const diff = Number((h.points - a.points).toFixed(1));
      return `${position}: ${diff > 0 ? `${home.teamAbbreviation} concedes ${diff} more` : `${away.teamAbbreviation} concedes ${-diff} more`}`;
    });
    rows.push(`Gap between the two defences — ${gaps.join("; ")}.`);
  }
  rows.push(
    "A soft matchup only matters if the player actually plays: check minutes and role before leaning on this. It is context, not a reason on its own.",
  );
  return rows.join("\n");
}
