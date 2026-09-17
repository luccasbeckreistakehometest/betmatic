/**
 * An in-play snapshot from ESPN's summary: clock, score, team counts and per-player lines. Pure.
 */
export interface LivePlayer { id: string; name: string; team: string; stats: Record<string, number> }

export interface LiveSnapshot {
  gameId: string;
  sportGroup: "basketball" | "soccer";
  state: "pre" | "in" | "post";
  clock: string;
  period: number;
  /** Share of regulation already played, 0–1. */
  elapsed: number;
  /** Soccer: the match minute; basketball: game minutes played. */
  minute: number;
  regulationMinutes: number;
  home: { abbr: string; score: number; stats: Record<string, number> };
  away: { abbr: string; score: number; stats: Record<string, number> };
  players: LivePlayer[];
  fetchedAt: string;
}

// ESPN's summary JSON is undocumented; accesses are optional-chained.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const made = (v: unknown): number => {
  const m = String(v ?? "").match(/^(\d+)-/);
  return m ? Number(m[1]) : n(v);
};

/** ESPN soccer stat names → the game-log labels the markets settle on. */
const SOCCER_STATS: Record<string, string> = {
  totalShots: "SHOT", shotsOnTarget: "SOG", foulsCommitted: "FC", foulsSuffered: "FA", yellowCards: "YC", redCards: "RC",
  totalGoals: "G", goalAssists: "A", offsides: "OF", wonCorners: "CORNERS", saves: "SV",
};

export function soccerMinute(display: string): number {
  const m = String(display ?? "").match(/(\d+)(?:'\s*\+\s*(\d+))?/);
  return m ? Math.min(90, Number(m[1])) : 0;
}

export function parseLiveSnapshot(summary: Json, gameId: string, sportGroup: "basketball" | "soccer", periodMinutes = 12, now = new Date()): LiveSnapshot {
  const comp = summary?.header?.competitions?.[0] ?? {};
  const status = comp.status ?? {};
  const state = (status.type?.state ?? "pre") as LiveSnapshot["state"];
  const competitors = (comp.competitors ?? []) as Json[];
  const side = (where: "home" | "away") => competitors.find((c) => c.homeAway === where) ?? {};
  const period = n(status.period);
  const regulation = sportGroup === "soccer" ? 90 : periodMinutes * 4;
  let minute: number;
  if (sportGroup === "soccer") {
    minute = state === "post" ? 90 : soccerMinute(status.displayClock ?? "");
  } else {
    const clockLeft = Number.isFinite(Number(status.clock)) ? Number(status.clock) / 60 : 0;
    minute = state === "post" ? regulation : Math.min(regulation, Math.max(0, (Math.min(period, 4) - 1) * periodMinutes + (periodMinutes - clockLeft)));
  }
  const teamStats = (abbr: string): Record<string, number> => {
    const block = ((summary?.boxscore?.teams ?? []) as Json[]).find((t) => t.team?.abbreviation === abbr);
    const out: Record<string, number> = {};
    for (const s of (block?.statistics ?? []) as Json[]) {
      const label = SOCCER_STATS[String(s.name)] ?? String(s.name);
      out[label] = n(s.displayValue ?? s.value);
    }
    return out;
  };

  const players: LivePlayer[] = [];
  if (sportGroup === "basketball") {
    for (const group of (summary?.boxscore?.players ?? []) as Json[]) {
      const team = String(group.team?.abbreviation ?? "");
      const stat = group.statistics?.[0] ?? {};
      const labels = (stat.labels ?? []) as string[];
      for (const a of (stat.athletes ?? []) as Json[]) {
        const raw = (a.stats ?? []) as string[];
        if (!raw.length) continue;
        const stats: Record<string, number> = {};
        labels.forEach((label, i) => { stats[label] = label === "3PT" || label === "FG" || label === "FT" ? made(raw[i]) : n(raw[i]); });
        players.push({ id: String(a.athlete?.id ?? ""), name: String(a.athlete?.displayName ?? ""), team, stats });
      }
    }
  } else {
    for (const roster of (summary?.rosters ?? []) as Json[]) {
      const team = String(roster.team?.abbreviation ?? "");
      for (const p of (roster.roster ?? []) as Json[]) {
        const stats: Record<string, number> = {};
        for (const s of (p.stats ?? []) as Json[]) {
          const label = SOCCER_STATS[String(s.name)];
          if (label) stats[label] = n(s.value ?? s.displayValue);
        }
        // ESPN prints subbedIn as an object ({ didSub: false }) on live payloads, a boolean on some older ones.
        const subbedIn = p.subbedIn === true || p.subbedIn?.didSub === true;
        players.push({ id: String(p.athlete?.id ?? ""), name: String(p.athlete?.displayName ?? ""), team, stats: { ...stats, STARTER: p.starter ? 1 : 0, SUBBED_IN: subbedIn ? 1 : 0 } });
      }
    }
  }

  const home = side("home");
  const away = side("away");
  const homeAbbr = String(home.team?.abbreviation ?? "");
  const awayAbbr = String(away.team?.abbreviation ?? "");
  return {
    gameId, sportGroup, state,
    clock: String(status.displayClock ?? status.type?.shortDetail ?? ""),
    period,
    elapsed: regulation ? Math.min(1, minute / regulation) : 0,
    minute: Math.round(minute * 10) / 10,
    regulationMinutes: regulation,
    home: { abbr: homeAbbr, score: n(home.score), stats: teamStats(homeAbbr) },
    away: { abbr: awayAbbr, score: n(away.score), stats: teamStats(awayAbbr) },
    players,
    fetchedAt: now.toISOString(),
  };
}
