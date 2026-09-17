import { cached } from "@/lib/cache";
import { getAthleteBasics, getGameDetail, getTeamRoster } from "@/lib/sources/espn";
import { getPropPrices } from "@/lib/sources/espn-props";
import { computeDvp, type DvpLine } from "@/lib/signals/dvp";
import { historyFor, roleFor } from "@/lib/props/candidates";
import { defaultLineFor, type DvpView, type PlayerProfileView, type PostedLineView, type RoleView } from "@/lib/props/player-view";
import { getSport } from "@/lib/sports";
import type { RoleProfile } from "@/lib/props/role";
import type { PlayerGame } from "@/lib/types";

const TTL = 30 * 60_000;
const MAX_GAMES = 40;

const bucketOf = (pos: string | null | undefined): "G" | "F" | "C" | null => {
  const p = (pos ?? "").toUpperCase();
  return p.startsWith("G") ? "G" : p.startsWith("F") ? "F" : p.startsWith("C") ? "C" : null;
};

const finite = (n: number) => (Number.isFinite(n) ? n : null);

function roleView(role: RoleProfile | null): RoleView | null {
  if (!role) return null;
  return {
    tier: role.tier, minutesPerGame: finite(role.minutesPerGame), recentMinutes: finite(role.recentMinutes),
    minutesTrend: role.minutesTrend, reliability: role.reliability, games: role.games, note: role.note,
  };
}

const conceded = (line: DvpLine | undefined) => (line ? { points: line.points, rebounds: line.rebounds, assists: line.assists, threes: line.threes } : null);

/**
 * Everything the player deep dive shows, from ESPN only (no model call): the game log, the role, the
 * opponent's concession by position, and the lines the book posted with their no-vig chance.
 * Cached 30 minutes per athlete and game.
 */
export async function buildPlayerProfile(sportKey: string, athleteId: string, gameId: string | null): Promise<PlayerProfileView | null> {
  const sport = getSport(sportKey);
  if (!sport.hasPlayerGamelog || (sport.group !== "basketball" && sport.group !== "soccer")) return null;
  const group = sport.group;
  return cached(`player-profile-${sport.key}-${athleteId}-${gameId ?? "none"}`, TTL, async () => {
    const detail = gameId ? await getGameDetail(gameId, false, sport.key).catch(() => null) : null;
    let name = "";
    let teamAbbr = "";
    let teamId = "";
    let position: string | null = null;
    let teammates: { id: string; name: string }[] = [];
    if (detail) {
      const side = detail.rosters.find((r) => (r.athletes ?? []).some((a) => a.id === athleteId));
      const me = side?.athletes?.find((a) => a.id === athleteId);
      if (side && me) {
        name = me.name;
        teamAbbr = side.teamAbbreviation;
        position = me.position ?? null;
        teamId = [detail.game.home, detail.game.away].find((t) => t.abbreviation === side.teamAbbreviation)?.id ?? "";
        teammates = (side.athletes ?? []).filter((a) => a.id !== athleteId).map((a) => ({ id: a.id, name: a.name }));
      }
    }
    if (!name) {
      const basics = await getAthleteBasics(sport.key, athleteId);
      if (!basics) return null;
      name = basics.name;
      teamAbbr = basics.teamAbbr;
      teamId = basics.teamId;
      position = basics.position;
      if (teamId) teammates = (await getTeamRoster(sport.key, teamId)).filter((a) => a.id !== athleteId).map((a) => ({ id: a.id, name: a.name }));
    }

    const history = await historyFor(sport.key, athleteId);
    if (!history?.games.length) return null;
    const role = await roleFor(sport, { athleteId, name }, history);

    const markets = sport.markets.filter((m) => m.statLabels.length && m.key !== "minutes");
    const keep = new Set(["MIN", ...markets.flatMap((m) => m.statLabels)]);
    const games: PlayerGame[] = history.games.slice(0, MAX_GAMES).map((g) => ({
      ...g,
      stats: Object.fromEntries(Object.entries(g.stats).filter(([k]) => keep.has(k))),
    }));

    const posted: PostedLineView[] = [];
    if (detail && detail.game.status === "scheduled") {
      const feed = await getPropPrices(sport.key, detail.game.id).catch(() => null);
      for (const p of feed?.props ?? []) {
        if (p.athleteId !== athleteId) continue;
        posted.push({ marketKey: p.marketKey, line: p.line, side: p.side, decimal: p.decimal, openDecimal: p.openDecimal, noVigFair: p.noVigFair, kind: p.kind });
      }
    }

    let dvp: DvpView | null = null;
    const bucket = bucketOf(position);
    if (detail && group === "basketball" && bucket) {
      const opponent = detail.game.home.abbreviation === teamAbbr ? detail.game.away : detail.game.home;
      const own = detail.game.home.abbreviation === teamAbbr ? detail.game.home : detail.game.away;
      const [theirs, ours] = await Promise.all([
        computeDvp(sport.key, opponent.id, opponent.abbreviation).catch(() => null),
        computeDvp(sport.key, own.id, own.abbreviation).catch(() => null),
      ]);
      const line = theirs?.lines.find((l) => l.position === bucket);
      if (theirs && line) {
        dvp = { position: bucket, opponent: opponent.abbreviation, opponentConcedes: conceded(line)!, ownConcedes: conceded(ours?.lines.find((l) => l.position === bucket)), games: theirs.games };
      }
    }

    const opponent = detail ? (detail.game.home.abbreviation === teamAbbr ? detail.game.away : detail.game.home) : null;
    return {
      athleteId,
      sportKey: sport.key,
      sportGroup: group,
      name,
      teamAbbr,
      position,
      game: detail && opponent ? { id: detail.game.id, matchup: `${detail.game.away.displayName} @ ${detail.game.home.displayName}`, startsAt: detail.game.startsAt, opponentAbbr: opponent.abbreviation, status: detail.game.status } : null,
      games,
      markets: markets.map((m) => {
        const rows = posted.filter((p) => p.marketKey === m.key).sort((a, b) => a.line - b.line);
        const total = rows.find((r) => r.kind === "total");
        return { key: m.key, label: m.label, statLabels: m.statLabels, binary: !!m.binary, defaultLine: total?.line ?? defaultLineFor(games, m), posted: rows };
      }),
      role: roleView(role),
      dvp,
      teammates: teammates.slice(0, 30),
      usesMinutes: group === "basketball",
      generatedAt: new Date().toISOString(),
    } satisfies PlayerProfileView;
  });
}

/** The minimum a "com/sem" split needs from a teammate: which games he played, and for how long. */
export async function teammateLog(sportKey: string, athleteId: string): Promise<Pick<PlayerGame, "eventId" | "stats">[]> {
  const history = await historyFor(sportKey, athleteId);
  return (history?.games ?? []).slice(0, 82).map((g): Pick<PlayerGame, "eventId" | "stats"> => ({ eventId: g.eventId, stats: g.stats.MIN !== undefined ? { MIN: g.stats.MIN } : {} }));
}
