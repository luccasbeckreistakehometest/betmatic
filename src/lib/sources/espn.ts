import { cached } from "@/lib/cache";
import { DEFAULT_SPORT, getSport, type SportDef } from "@/lib/sports";
import type {
  Game, GameDetail, GameStatus, InjuryEntry, PlayerGame, PlayerHistory, TeamRef, TeamStatLine,
} from "@/lib/types";

const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const COMMON = "https://site.api.espn.com/apis/common/v3/sports";

function base(sport: SportDef): string {
  return `${SITE}/${sport.espnSport}/${sport.espnLeague}`;
}

const TTL = {
  scoreboardLive: 45_000,
  scoreboard: 5 * 60_000,
  summary: 3 * 60_000,
  roster: 12 * 60 * 60_000,
  gamelog: 6 * 60 * 60_000,
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

function mapGame(event: Json, sport: SportDef): Game | null {
  const comp = event?.competitions?.[0];
  if (!comp) return null;
  const competitors: Json[] = comp.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const rawOdds = comp.odds?.[0];
  return {
    id: String(event.id),
    sportKey: sport.key,
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

function mapTennisCompetitor(competitor: Json): TeamRef {
  const athlete = competitor?.athlete ?? {};
  const sets = ((competitor.linescores ?? []) as Json[]).map((l) => l.value).filter((v) => v != null);
  return {
    id: String(athlete.id ?? competitor.id ?? ""),
    athleteId: athlete.id ? String(athlete.id) : undefined,
    abbreviation: athlete.shortName ?? athlete.displayName ?? "",
    name: athlete.displayName ?? "",
    displayName: athlete.displayName ?? "",
    logo: athlete.flag?.href,
    country: athlete.flag?.alt ?? athlete.citizenship,
    score: sets.length ? sets.filter((v: number) => Number(v) > 0).length : undefined,
    record: sets.length ? sets.join("-") : undefined,
  };
}

/** A tennis "event" is a tournament; the bettable unit is one match inside a grouping. */
function mapTennisMatches(event: Json, sport: SportDef, dateKey?: string): Game[] {
  const out: Game[] = [];
  for (const grouping of (event.groupings ?? []) as Json[]) {
    const groupName = grouping.grouping?.displayName ?? "";
    // Doubles pair two athletes per side and do not fit the head-to-head model.
    if (/doubles/i.test(groupName)) continue;
    for (const comp of (grouping.competitions ?? []) as Json[]) {
      const sides = (comp.competitors ?? []) as Json[];
      if (sides.length !== 2) continue;
      const [a, b] = sides;
      // ESPN hands back the entire draw, so the day filter has to happen here.
      const compDate = comp.date ?? event.date;
      if (dateKey && compDate && espnDateKey(new Date(compDate)) !== dateKey) continue;
      out.push({
        id: String(comp.id),
        sportKey: sport.key,
        tournament: event.name ?? event.shortName,
        round: comp.round?.displayName ?? groupName,
        startsAt: comp.date ?? event.date,
        status: mapStatus(comp.status?.type?.state),
        statusDetail: comp.status?.type?.shortDetail ?? "",
        home: mapTennisCompetitor(a),
        away: mapTennisCompetitor(b),
        venue: event.venue?.fullName,
      });
    }
  }
  return out;
}

export async function getSlate(dateKey: string, force = false, sportKey = DEFAULT_SPORT): Promise<Game[]> {
  const sport = getSport(sportKey);
  const isToday = dateKey === todayKey();
  return cached(
    `espn-scoreboard-${sport.key}-${dateKey}`,
    isToday ? TTL.scoreboardLive : TTL.scoreboard,
    async () => {
      const data = await getJson(`${base(sport)}/scoreboard?dates=${dateKey}&limit=100`);
      const events = (data.events ?? []) as Json[];
      const games =
        sport.kind === "tennis"
          ? events.flatMap((ev) => mapTennisMatches(ev, sport, dateKey))
          : events.map((ev) => mapGame(ev, sport)).filter((g): g is Game => Boolean(g));
      return games.sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));
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

async function getRoster(sport: SportDef, teamId: string): Promise<{ name: string; id: string }[]> {
  if (!teamId) return [];
  return cached(`espn-roster-${sport.key}-${teamId}`, TTL.roster, async () => {
    try {
      const data = await getJson(`${base(sport)}/teams/${teamId}/roster`);
      const groups = (data.athletes ?? []) as Json[];
      // ESPN returns either a flat athlete list or position-grouped buckets.
      const flat = groups.flatMap((g) => (Array.isArray(g.items) ? g.items : [g]));
      return flat
        .map((a: Json) => ({ name: a.displayName ?? a.fullName ?? "", id: String(a.id ?? "") }))
        .filter((a) => a.name);
    } catch {
      return [];
    }
  });
}

export async function getGameDetail(
  gameId: string,
  force = false,
  sportKey = DEFAULT_SPORT,
): Promise<GameDetail | null> {
  const sport = getSport(sportKey);
  const summary = await cached(
    `espn-summary-${sport.key}-${gameId}`,
    TTL.summary,
    () => getJson(`${base(sport)}/summary?event=${gameId}`),
    force,
  );

  // Tennis summaries have no header competition; the slate entry is the source of truth.
  if (sport.kind === "tennis") {
    let match: Game | undefined;
    for (let offset = 0; offset <= 14 && !match; offset += 1) {
      for (const key of offset === 0 ? [todayKey()] : [shiftKey(todayKey(), offset), shiftKey(todayKey(), -offset)]) {
        const slate = await getSlate(key, force, sport.key).catch(() => []);
        match = slate.find((g) => g.id === gameId);
        if (match) break;
      }
    }
    if (!match) return null;
    return {
      game: match, books: [], ats: [], injuries: [],
      teamStats: { home: [], away: [] }, leaders: [], lastMeetings: [],
      rosters: [
        { teamAbbreviation: match.home.abbreviation, players: [match.home.displayName] },
        { teamAbbreviation: match.away.abbreviation, players: [match.away.displayName] },
      ],
    };
  }

  const header = summary.header ?? {};
  const game = mapGame(
    {
      id: gameId,
      date: header.competitions?.[0]?.date,
      status: header.competitions?.[0]?.status,
      competitions: header.competitions,
    },
    sport,
  );
  if (!game) return null;

  // The summary header omits venue/broadcast/odds; pull them from the day's scoreboard.
  const slate = await getSlate(espnDateKey(new Date(game.startsAt)), force, sport.key).catch(() => []);
  const fromSlate = slate.find((g) => g.id === gameId);
  const merged: Game = fromSlate ? mergeGames(fromSlate, game) : game;

  const [homeRoster, awayRoster] = await Promise.all([
    getRoster(sport, merged.home.id),
    getRoster(sport, merged.away.id),
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
      { teamAbbreviation: merged.home.abbreviation, players: homeRoster.map((p) => p.name), athletes: homeRoster },
      { teamAbbreviation: merged.away.abbreviation, players: awayRoster.map((p) => p.name), athletes: awayRoster },
    ],
  };
}



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
async function nearestGameDay(sport: SportDef, fromKey: string, toKey: string, pick: "first" | "last"): Promise<string | null> {
  try {
    const data = await getJson(`${base(sport)}/scoreboard?dates=${fromKey}-${toKey}&limit=300`);
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
  sportKey = DEFAULT_SPORT,
  spanDays = 150,
): Promise<SlateResult> {
  const sport = getSport(sportKey);
  const direct = await getSlate(dateKey, force, sport.key);
  if (direct.length) return { dateKey, requestedKey: dateKey, games: direct, shifted: false };

  const forward = await nearestGameDay(sport, shiftKey(dateKey, 1), shiftKey(dateKey, spanDays), "first");
  const backward = await nearestGameDay(sport, shiftKey(dateKey, -spanDays), shiftKey(dateKey, -1), "last");

  // Prefer whichever is fewer days away; ties go to the upcoming slate.
  const distance = (key: string | null) => {
    if (!key) return Number.POSITIVE_INFINITY;
    const toDate = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8));
    return Math.abs(toDate(key) - toDate(dateKey));
  };
  const chosen = distance(forward) <= distance(backward) ? forward : backward;
  if (!chosen) return { dateKey, requestedKey: dateKey, games: [], shifted: false };

  const games = await getSlate(chosen, force, sport.key);
  return { dateKey: chosen, requestedKey: dateKey, games, shifted: true };
}

export { shiftKey };

/**
 * Per-game stat lines for one athlete. This is what lets the app check a prop line against reality
 * instead of trusting whatever hit rate a paid tool printed.
 */
export async function getPlayerHistory(
  sportKey: string,
  athleteId: string,
  force = false,
  /**
   * Without this the endpoint only returns the current season. Four games into a campaign that is
   * not a rate, it is a rumour — the prior season is the only sample large enough to regress to.
   */
  season?: number,
): Promise<PlayerHistory | null> {
  const sport = getSport(sportKey);
  if (!sport.hasPlayerGamelog || !athleteId) return null;

  return cached(
    `espn-gamelog-${sport.key}-${athleteId}${season ? `-${season}` : ""}`,
    TTL.gamelog,
    async () => {
      try {
        const data = await getJson(
          `${COMMON}/${sport.espnSport}/${sport.espnLeague}/athletes/${athleteId}/gamelog${season ? `?season=${season}` : ""}`,
        );
        const labels: string[] = (data.labels ?? data.names ?? []) as string[];
        const eventMeta = (data.events ?? {}) as Record<string, Json>;

        const games: PlayerGame[] = [];
        for (const seasonType of (data.seasonTypes ?? []) as Json[]) {
          for (const category of (seasonType.categories ?? []) as Json[]) {
            for (const entry of (category.events ?? []) as Json[]) {
              const meta = eventMeta[String(entry.eventId)] ?? {};
              const stats: Record<string, number | string> = {};
              labels.forEach((label, i) => {
                const raw = entry.stats?.[i];
                if (raw === undefined) return;
                const num = Number(raw);
                stats[label] = Number.isFinite(num) && !String(raw).includes("-") ? num : raw;
              });
              games.push({
                eventId: String(entry.eventId),
                date: meta.gameDate ?? "",
                opponent: meta.opponent?.abbreviation ?? "",
                homeAway: meta.atVs === "@" ? "@" : meta.atVs === "vs" ? "vs" : "",
                result: `${meta.gameResult ?? ""} ${meta.score ?? ""}`.trim(),
                stats,
              });
            }
          }
        }
        // Newest first so "last 5" means the most recent five.
        games.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
        return { athleteId, player: "", team: "", games, availableStats: labels };
      } catch {
        return null;
      }
    },
    force,
  );
}


export interface SeasonRole {
  athleteId: string;
  /** Matches begun in the starting eleven. */
  starts: number;
  /** Matches entered from the bench. */
  subIns: number;
  appearances: number;
  startShare: number;
  seasonLabel: string;
}

/**
 * Starts and substitute appearances for the current season.
 *
 * The minutes gate in props/role.ts reads MIN off the game log, which works for basketball and
 * silently returns null for football: ESPN's football game log publishes G, A, SHOT, SOG, FC, FA,
 * OF, YC, RC and no minutes at all. The gate was therefore dead code for every football prop ever
 * priced here. Starts-versus-substitute-appearances is the equivalent signal the API does expose,
 * and it is the one that matters — a bookmaker's player ladder is priced for someone who starts.
 */
export async function getSeasonRole(sportKey: string, athleteId: string): Promise<SeasonRole | null> {
  const sport = getSport(sportKey);
  if (!athleteId) return null;
  return cached(`espn-role-${sport.key}-${athleteId}`, TTL.gamelog, async () => {
    try {
      const data = await getJson(
        `https://site.web.api.espn.com/apis/common/v3/sports/${sport.espnSport}/${sport.espnLeague}/athletes/${athleteId}`,
      );
      const summary = (data.athlete as Json | undefined)?.statsSummary as Json | undefined;
      const entry = ((summary?.statistics ?? []) as Json[]).find((s) => s.name === "starts-subIns");
      if (!entry) return null;
      // displayValue reads "4 (0)" — starts, then substitute appearances in brackets.
      const parsed = String(entry.displayValue ?? "").match(/(\d+)\s*\((\d+)\)/);
      if (!parsed) return null;
      const starts = Number(parsed[1]);
      const subIns = Number(parsed[2]);
      const appearances = starts + subIns;
      return {
        athleteId,
        starts,
        subIns,
        appearances,
        startShare: appearances ? Number((starts / appearances).toFixed(2)) : 0,
        seasonLabel: String(summary?.displayName ?? ""),
      };
    } catch {
      return null;
    }
  });
}
