import { cached } from "@/lib/cache";
import { getSport } from "@/lib/sports";
import { espnJson, type Json } from "@/lib/sources/espn-http";

/**
 * ESPN's per-athlete season splits: the same player cut by where the game was played, by how much
 * rest she had, and by who was in front of her. It answers a plain client with no token and no
 * challenge (probed 24/09/2026), which is the bar sources/br-books/registry.ts sets for every feed.
 *
 * TWO THINGS MEASURED BEFORE THIS WAS WIRED IN, because both decide what the caller may say:
 *
 * 1. The WNBA feed is a SHELL. /athletes/<id>/splits answers 200 with byOpponent (19 rows) and
 *    byArena (31 rows) present — and every one of those rows is labelled "All Splits" / "Total" and
 *    repeats the season line verbatim. Three athletes, three seasons, same thing. So the league
 *    publishes the envelope and none of the contents, and `parseSplits` drops any row that is not
 *    a named cut rather than printing the season average nineteen times as if it were a matchup.
 * 2. Even where the feed is real (the NBA publishes it fully), the OPPONENT cut is small-sample by
 *    construction: LeBron James 2024-25 faced 28 opponents with a median of 2 games each and NOT
 *    ONE of them reached five. That is the cut this file exists to gate, not to advertise —
 *    signals/splits.ts names it insufficient instead of printing a number nobody may lean on.
 *
 * What survives the gate is the venue cut: 30-40 games a side, every season, and the one piece of
 * "where is this game played" the pipeline did not already have.
 */
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports";
/** A season split moves once per game; a day is still fresh and costs one request per player. */
const TTL = 12 * 60 * 60_000;

/** One named cut of a season, per game, exactly as ESPN publishes it. */
export interface SplitLine {
  /** ESPN's own label for the cut: "Home", "Road", "3+ Days Rest", "Boston Celtics". */
  label: string;
  /** "vs BOS", "Home" — how ESPN abbreviates the cut. */
  abbreviation: string;
  games: number;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  /** Threes MADE per game; ESPN prints made-attempted in one cell. */
  threes: number | null;
  fieldGoalPct: number | null;
}

export interface AthleteSplits {
  athleteId: string;
  season: number;
  /** The "All Splits" row: the season baseline every other cut is read against. */
  overall: SplitLine | null;
  home: SplitLine | null;
  road: SplitLine | null;
  /** The "3+ Days Rest" cut, when the league publishes it. */
  rested: SplitLine | null;
  /** Named opponent cuts, keyed by the team abbreviation ESPN prints ("BOS"). Empty on a shell feed. */
  byOpponent: Record<string, SplitLine>;
}

/** ESPN repeats the season row under this name when it has no real cut to publish. */
const SHELL_LABEL = "All Splits";

const num = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** ESPN prints made-attempted in one cell ("7.2-15.9"); only the made side is a countable stat. */
const madeOf = (value: string | undefined): number | null => {
  if (!value) return null;
  const m = value.match(/^(-?\d+(?:\.\d+)?)-/);
  return m ? Number(m[1]) : num(value);
};

/** "vs BOS" / "@ BOS" → "BOS". A cut with no team in it keeps its own abbreviation. */
export function opponentAbbreviation(abbreviation: string): string {
  const m = abbreviation.match(/(?:vs\.?|@)\s*([A-Z]{2,4})/i);
  return (m ? m[1] : abbreviation).toUpperCase();
}

function lineFrom(split: Json, index: (label: string) => number): SplitLine | null {
  const stats: string[] = Array.isArray(split.stats) ? split.stats : [];
  if (!stats.length) return null;
  const at = (label: string) => { const i = index(label); return i >= 0 ? stats[i] : undefined; };
  const games = num(at("GP"));
  if (games === null || games <= 0) return null;
  return {
    label: String(split.displayName ?? ""),
    abbreviation: String(split.abbreviation ?? ""),
    games,
    minutes: num(at("MIN")),
    points: num(at("PTS")),
    rebounds: num(at("REB")),
    assists: num(at("AST")),
    threes: madeOf(at("3PT")),
    fieldGoalPct: num(at("FG%")),
  };
}

/**
 * Pure: the splits we can stand behind, out of one raw payload. Exported for the tests, which feed
 * it the real WNBA shell and the real NBA payload and expect the shell to yield nothing.
 */
export function parseSplits(data: Json, athleteId: string, season: number): AthleteSplits {
  const labels: string[] = Array.isArray(data.labels) ? data.labels : [];
  const names: string[] = Array.isArray(data.names) ? data.names : [];
  // `labels` is what the rest of the codebase indexes ESPN stat rows by (see signals/dvp.ts); the
  // machine `names` array is the fallback for a payload that ships one and not the other.
  const index = (label: string) => {
    const i = labels.indexOf(label);
    if (i >= 0) return i;
    return names.indexOf(label);
  };
  const empty: AthleteSplits = { athleteId, season, overall: null, home: null, road: null, rested: null, byOpponent: {} };
  const categories: Json[] = Array.isArray(data.splitCategories) ? data.splitCategories : [];
  if (!categories.length || index("GP") < 0) return empty;

  const rowsOf = (name: string): Json[] => {
    const category = categories.find((c) => c.name === name);
    return Array.isArray(category?.splits) ? (category!.splits as Json[]) : [];
  };
  /** The shell guard: a cut whose name is still "All Splits" is the season row wearing a costume. */
  const named = (rows: Json[]) => rows.filter((r) => String(r.displayName ?? "") !== SHELL_LABEL);

  const base = rowsOf("split");
  const overall = base.find((r) => String(r.displayName ?? "") === SHELL_LABEL);
  const find = (rows: Json[], test: (label: string) => boolean) => {
    const hit = named(rows).find((r) => test(String(r.displayName ?? "")));
    return hit ? lineFrom(hit, index) : null;
  };

  const byOpponent: Record<string, SplitLine> = {};
  for (const row of named(rowsOf("byOpponent"))) {
    const line = lineFrom(row, index);
    if (!line) continue;
    const key = opponentAbbreviation(line.abbreviation || line.label);
    // Two rows for one opponent would be ESPN splitting home and away; keep the fuller sample.
    const held = byOpponent[key];
    if (!held || line.games > held.games) byOpponent[key] = line;
  }

  return {
    athleteId,
    season,
    overall: overall ? lineFrom(overall, index) : null,
    home: find(base, (l) => /^home$/i.test(l)),
    road: find(base, (l) => /^(road|away)$/i.test(l)),
    rested: find(base, (l) => /days?\s+rest/i.test(l)),
    byOpponent,
  };
}

/**
 * One cached request per player. Never throws: a missing or shelled feed leaves the caller with
 * nothing to say, which is the correct thing for it to say.
 */
export async function getAthleteSplits(sportKey: string, athleteId: string, season: number): Promise<AthleteSplits | null> {
  const sport = getSport(sportKey);
  if (sport.group !== "basketball" || !athleteId) return null;
  return cached(`splits-${sport.key}-${athleteId}-${season}`, TTL, async () => {
    try {
      const url = `${WEB}/${sport.espnSport}/${sport.espnLeague}/athletes/${athleteId}/splits?season=${season}`;
      const parsed = parseSplits(await espnJson(url, { timeoutMs: 6000 }), athleteId, season);
      // A payload with no named cut at all is the WNBA shell: store the null so the whole slate
      // costs one request per player per TTL rather than one per player per generation.
      return parsed.home || parsed.road || parsed.rested || Object.keys(parsed.byOpponent).length ? parsed : null;
    } catch {
      return null;
    }
  });
}
