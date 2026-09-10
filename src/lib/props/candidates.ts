import { getPlayerHistory } from "@/lib/sources/espn";
import { measureProp } from "@/lib/props/history";
import { getSport } from "@/lib/sports";
import type { GameDetail, PropRow } from "@/lib/types";

/** Lines sit on the half-point so they cannot push, mirroring how books price them. */
function candidateLine(median: number): number {
  return Math.max(0.5, Math.round(median) - 0.5);
}



/**
 * Builds prop candidates straight from ESPN game logs, so player legs are available even without a
 * paid props tool logged in. These carry a measured hit rate but no market price — the price has to
 * come from a book or a scraped source before a payout can be computed.
 */
export async function buildPropCandidates(
  detail: GameDetail,
  maxPlayersPerTeam = 3,
): Promise<PropRow[]> {
  const sport = getSport(detail.game.sportKey);
  if (!sport.hasPlayerGamelog) return [];

  // The statistical leaders are the players books actually post props on.
  const leaderNames = new Set(detail.leaders.map((l) => l.player));
  const picks: { name: string; id: string; team: string }[] = [];
  for (const roster of detail.rosters) {
    const athletes = (roster.athletes ?? []).filter((a) => leaderNames.has(a.name));
    for (const athlete of athletes.slice(0, maxPlayersPerTeam)) {
      picks.push({ ...athlete, team: roster.teamAbbreviation });
    }
  }
  if (!picks.length) return [];

  const out: PropRow[] = [];
  for (const pick of picks) {
    const history = await getPlayerHistory(detail.game.sportKey, pick.id).catch(() => null);
    if (!history?.games.length) continue;

    for (const marketDef of sport.markets) {
      if (!marketDef.statLabels.length) continue;
      const market = marketDef.label.en;
      // Probe with a throwaway line to learn the distribution, then centre the real candidate.
      const probe = measureProp(history, market, 0.5, "over", sport.key);
      if (!probe || !Number.isFinite(probe.median)) continue;
      // Yes/no markets (cards, red cards) always sit at 0.5.
      const line = marketDef.binary ? 0.5 : candidateLine(probe.median);
      const measured = measureProp(history, market, line, "over", sport.key);
      // Early in a season three games is all that exists. Surface it with the sample size attached
      // rather than returning nothing — measureProp's sampleNote already flags a thin sample.
      if (!measured || measured.season.of < 3) continue;

      out.push({
        player: pick.name,
        team: pick.team,
        market,
        line,
        side: "over",
        odds: undefined,
        book: undefined,
        note: `candidate from game logs — no market price attached · ${measured.sampleNote}`,
        measured,
      });
    }
  }

  // Strongest measured rates first; the model still has to justify each pick.
  return out
    .sort((a, b) => (b.measured?.impliedFair ?? 0) - (a.measured?.impliedFair ?? 0))
    .slice(0, 40);
}
