import { cached } from "@/lib/cache";
import type { Game, GameDetail, GameStatus, InjuryEntry, TeamRef, TeamStatLine } from "@/lib/types";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba";

const TTL = {
  scoreboardLive: 45_000,
  scoreboard: 5 * 60_000,
  summary: 3 * 60_000,
  roster: 12 * 60 * 60_000,
};

// ESPN's payloads are deeply nested and undocumented. A loose alias keeps the mappers readable;
// every access below is optional-chained and defaulted.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function getJson(url: string): Promise<Json> {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "nba-bets-dashboard/1.0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return (await res.json()) as Json;
}

/** ESPN's slate day is Eastern-time based; format a Date as YYYYMMDD in ET. */
export function espnDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

export function todayKey(): string {
  return espnDateKey(new Date());
}

function mapStatus(state?: string): GameStatus {
  if (state === "in") return "live";
  if (state === "post") return "final";
  return "scheduled";
}

function mapTeam(competitor: Json): TeamRef {
  const team = competitor?.team ?? {};
  return {
    id: String(team.id ?? ""),
    abbreviation: team.abbreviation ?? "",
    name: team.shortDisplayName ?? team.name ?? "",
    displayName: team.displayName ?? team.name ?? "",
    logo: team.logo ?? (team.logos ?? []).find((l: Json) => !l.rel?.includes("dark"))?.href ?? team.logos?.[0]?.href,
    color: team.color ? `#${team.color}` : undefined,
    record:
      ((competitor.records ?? []) as Json[]).find((r) => r.type === "total")?.summary ??
      ((competitor.records ?? []) as Json[])[0]?.summary ??
      (typeof competitor.record === "string" ? competitor.record : undefined),
    score: competitor.score != null ? Number(competitor.score) : undefined,
  };
}

function preferTeam(base: TeamRef, override: TeamRef): TeamRef {
  return {
    ...base,
    ...Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined && v !== "")),
  } as TeamRef;
}

/** Keeps whichever source actually has each field instead of letting undefined win. */
function mergeGames(base: Game, override: Game): Game {
  return {
    ...base,
    ...Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined && v !== "")),
    home: preferTeam(base.home, override.home),
    away: preferTeam(base.away, override.away),
    odds: override.odds ?? base.odds,
  } as Game;
}

function mapGame(event: Json): Game | null {
  const comp = event?.competitions?.[0];
  if (!comp) return null;
  const competitors: Json[] = comp.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const rawOdds = comp.odds?.[0];
  return {
    id: String(event.id),
    startsAt: event.date,
    status: mapStatus(event.status?.type?.state),
    statusDetail: event.status?.type?.shortDetail ?? event.status?.type?.detail ?? "",
    home: mapTeam(home),
    away: mapTeam(away),
    venue: comp.venue?.fullName,
    broadcast: comp.broadcasts?.[0]?.names?.join(", "),
    odds: rawOdds
      ? {
          provider: rawOdds.provider?.name,
          details: rawOdds.details,
          spread: rawOdds.spread != null ? Number(rawOdds.spread) : undefined,
          overUnder: rawOdds.overUnder != null ? Number(rawOdds.overUnder) : undefined,
          homeMoneyline: rawOdds.homeTeamOdds?.moneyLine,
          awayMoneyline: rawOdds.awayTeamOdds?.moneyLine,
        }
      : undefined,
  };
}

export async function getSlate(dateKey: string, force = false): Promise<Game[]> {
  const isToday = dateKey === todayKey();
  return cached(
    `espn-scoreboard-${dateKey}`,
    isToday ? TTL.scoreboardLive : TTL.scoreboard,
    async () => {
      const data = await getJson(`${BASE}/scoreboard?dates=${dateKey}&limit=30`);
      return ((data.events ?? []) as Json[])
        .map(mapGame)
        .filter((g): g is Game => Boolean(g))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    },
    force,
  );
}

function mapInjuries(summary: Json): InjuryEntry[] {
  const out: InjuryEntry[] = [];
  for (const block of (summary.injuries ?? []) as Json[]) {
    const abbr = block.team?.abbreviation ?? "";
    for (const item of (block.injuries ?? []) as Json[]) {
      out.push({
        teamAbbreviation: abbr,
        player: item.athlete?.displayName ?? "Unknown",
        position: item.athlete?.position?.abbreviation,
        status: item.status ?? item.type?.description ?? "Unknown",
        detail: [item.details?.type, item.details?.detail, item.longComment, item.shortComment]
          .filter(Boolean)
          .join(" — ") || undefined,
        updatedAt: item.date,
      });
    }
  }
  return out;
}

function mapTeamStats(summary: Json, abbreviation: string): TeamStatLine[] {
  const teams = (summary.boxscore?.teams ?? []) as Json[];
  const entry = teams.find((t) => t.team?.abbreviation === abbreviation);
  return ((entry?.statistics ?? []) as Json[])
    .map((s) => ({ label: s.label ?? s.name ?? "", value: String(s.displayValue ?? ""), rank: s.rankDisplayValue }))
    .filter((s) => s.label && s.value);
}

async function getRoster(teamId: string): Promise<string[]> {
  if (!teamId) return [];
  return cached(`espn-roster-${teamId}`, TTL.roster, async () => {
    try {
      const data = await getJson(`${BASE}/teams/${teamId}/roster`);
      const groups = (data.athletes ?? []) as Json[];
      // ESPN returns either a flat athlete list or position-grouped buckets.
      const flat = groups.flatMap((g) => (Array.isArray(g.items) ? g.items : [g]));
      return flat.map((a: Json) => a.displayName ?? a.fullName).filter(Boolean) as string[];
    } catch {
      return [];
    }
  });
}

export async function getGameDetail(gameId: string, force = false): Promise<GameDetail | null> {
  const summary = await cached(
    `espn-summary-${gameId}`,
    TTL.summary,
    () => getJson(`${BASE}/summary?event=${gameId}`),
    force,
  );

  const header = summary.header ?? {};
  const game = mapGame({
    id: gameId,
    date: header.competitions?.[0]?.date,
    status: header.competitions?.[0]?.status,
    competitions: header.competitions,
  });
  if (!game) return null;

  // The summary header omits venue/broadcast/odds; pull them from the day's scoreboard.
  const slate = await getSlate(espnDateKey(new Date(game.startsAt)), force).catch(() => []);
  const fromSlate = slate.find((g) => g.id === gameId);
  const merged: Game = fromSlate ? mergeGames(fromSlate, game) : game;

  const [homeRoster, awayRoster] = await Promise.all([
    getRoster(merged.home.id),
    getRoster(merged.away.id),
  ]);

  const books: GameDetail["books"] = ((summary.pickcenter ?? []) as Json[]).map((p) => ({
    provider: p.provider?.name,
    details: p.details,
    spread: p.spread != null ? Number(p.spread) : undefined,
    overUnder: p.overUnder != null ? Number(p.overUnder) : undefined,
    homeMoneyline: p.homeTeamOdds?.moneyLine,
    awayMoneyline: p.awayTeamOdds?.moneyLine,
    homeSpreadOdds: p.homeTeamOdds?.spreadOdds,
    awaySpreadOdds: p.awayTeamOdds?.spreadOdds,
    overOdds: p.overOdds,
    underOdds: p.underOdds,
  }));

  const ats: GameDetail["ats"] = ((summary.againstTheSpread ?? []) as Json[])
    .map((a) => ({
      teamAbbreviation: a.team?.abbreviation ?? "",
      record: ((a.records ?? []) as Json[])
        .map((r) => `${r.summary ?? ""} ${r.type ?? ""}`.trim())
        .filter(Boolean)
        .join(" · "),
    }))
    .filter((row) => row.teamAbbreviation && row.record);

  const leaders: GameDetail["leaders"] = [];
  for (const block of (summary.leaders ?? []) as Json[]) {
    const abbr = block.team?.abbreviation ?? "";
    for (const category of (block.leaders ?? []) as Json[]) {
      const top = category.leaders?.[0];
      if (!top) continue;
      leaders.push({
        teamAbbreviation: abbr,
        player: top.athlete?.displayName ?? "",
        line: `${category.displayName ?? category.name}: ${top.displayValue ?? ""}`,
      });
    }
  }

  const lastMeetings = ((summary.seasonseries?.[0]?.events ?? []) as Json[]).slice(0, 6).map((ev) => {
    const sides = (ev.competitors ?? []) as Json[];
    const away = sides.find((c) => c.homeAway === "away");
    const home = sides.find((c) => c.homeAway === "home");
    const matchup = away && home ? `${away.team?.abbreviation ?? "?"} @ ${home.team?.abbreviation ?? "?"}` : "";
    const played = ev.statusType?.completed === true;
    const result = played
      ? `${away?.score ?? "?"}-${home?.score ?? "?"}`
      : (ev.statusType?.shortDetail ?? "");
    return { date: ev.date ?? "", summary: `${matchup} ${result}`.trim() };
  });

  return {
    game: { ...merged, odds: merged.odds ?? books[0] },
    books,
    ats,
    injuries: mapInjuries(summary),
    teamStats: {
      home: mapTeamStats(summary, merged.home.abbreviation),
      away: mapTeamStats(summary, merged.away.abbreviation),
    },
    predictor: summary.predictor
      ? {
          homeWinPct: Number(summary.predictor.homeTeam?.gameProjection ?? NaN) || undefined,
          awayWinPct: Number(summary.predictor.awayTeam?.gameProjection ?? NaN) || undefined,
        }
      : undefined,
    leaders,
    lastMeetings,
    rosters: [
      { teamAbbreviation: merged.home.abbreviation, players: homeRoster },
      { teamAbbreviation: merged.away.abbreviation, players: awayRoster },
    ],
  };
}

export { CORE };

export interface SlateResult {
  dateKey: string;
  requestedKey: string;
  games: Game[];
  /** True when the requested date had no games and we walked forward/back to the nearest slate. */
  shifted: boolean;
}

function shiftKey(dateKey: string, days: number): string {
  const y = Number(dateKey.slice(0, 4));
  const m = Number(dateKey.slice(4, 6));
  const d = Number(dateKey.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, "0")}${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** One range query beats walking day by day — ESPN supports dates=YYYYMMDD-YYYYMMDD. */
async function nearestGameDay(fromKey: string, toKey: string, pick: "first" | "last"): Promise<string | null> {
  try {
    const data = await getJson(`${BASE}/scoreboard?dates=${fromKey}-${toKey}&limit=200`);
    const dates = ((data.events ?? []) as Json[])
      .map((ev) => (ev.date ? espnDateKey(new Date(ev.date)) : null))
      .filter((d): d is string => Boolean(d))
      .sort();
    if (!dates.length) return null;
    return pick === "first" ? dates[0] : dates[dates.length - 1];
  } catch {
    return null;
  }
}

/**
 * The NBA has a four-month offseason, so an empty slate is normal rather than an error.
 * Finds the closest day that actually has games — forward first, then backward.
 */
export async function getSlateOrNearest(
  dateKey: string,
  force = false,
  spanDays = 150,
): Promise<SlateResult> {
  const direct = await getSlate(dateKey, force);
  if (direct.length) return { dateKey, requestedKey: dateKey, games: direct, shifted: false };

  const forward = await nearestGameDay(shiftKey(dateKey, 1), shiftKey(dateKey, spanDays), "first");
  const backward = await nearestGameDay(shiftKey(dateKey, -spanDays), shiftKey(dateKey, -1), "last");

  // Prefer whichever is fewer days away; ties go to the upcoming slate.
  const distance = (key: string | null) => {
    if (!key) return Number.POSITIVE_INFINITY;
    const toDate = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8));
    return Math.abs(toDate(key) - toDate(dateKey));
  };
  const chosen = distance(forward) <= distance(backward) ? forward : backward;
  if (!chosen) return { dateKey, requestedKey: dateKey, games: [], shifted: false };

  const games = await getSlate(chosen, force);
  return { dateKey: chosen, requestedKey: dateKey, games, shifted: true };
}

export { shiftKey };
