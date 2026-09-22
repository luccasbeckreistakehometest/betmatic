import { teamNames, type TeamLike } from "@/lib/resolve/names";
import { normaliseTeam, stripAccents, teamKey } from "@/lib/sources/br-books/normalise";
import type { BookEvent } from "@/lib/sources/br-books/types";

/**
 * A book's event → the ESPN game it is. External ids first: books that share a Betradar id are the
 * same fixture, and once any of them is matched the rest follow. Then names: both teams must be
 * found (in either order — Betfair and Sportingbet list the away side first) and the kickoff must
 * sit within thirty minutes. Anything left is surfaced in the admin panel to be fixed by hand.
 */
export interface MatchableGame { id: string; startsAt: string; home: TeamLike; away: TeamLike }

export interface EventMatch {
  gameId: string;
  matchedBy: "external" | "names" | "manual";
  /** True when the book lists the ESPN home side as away: home/away sides must be flipped. */
  swapped: boolean;
}

export const KICKOFF_TOLERANCE_MS = 30 * 60_000;

/** Team names a Brazilian book prints that ESPN does not, beyond lib/resolve/names.ts's list. */
const EXTRA_ALIASES: Record<string, string[]> = {
  "los angeles sparks": ["la sparks"],
  "new york liberty": ["ny liberty"],
  "golden state valkyries": ["gs valkyries"],
  "las vegas aces": ["lv aces"],
  "connecticut sun": ["conn sun"],
  "remo": ["clube do remo", "remo pa", "remo-pa"],
  "atletico mineiro": ["atletico mg", "atletico-mg"],
  "athletico paranaense": ["athletico pr", "athletico-pr"],
  "operario": ["operario pr", "operario-pr"],
  "criciuma": ["criciuma sc"],
  "red bull bragantino": ["rb bragantino"],
};

/** Every spelling a team goes by, normalised: ESPN's names, the shared alias table, this file's. */
export function aliasesOf(team: TeamLike): Set<string> {
  const out = new Set<string>();
  for (const n of teamNames(team)) out.add(teamKey(n));
  const display = teamKey(team.displayName);
  out.add(display);
  if (team.name) out.add(teamKey(team.name));
  for (const [canon, list] of Object.entries(EXTRA_ALIASES)) {
    if (out.has(canon) || display.includes(canon)) list.forEach((a) => out.add(teamKey(a)));
  }
  return out;
}

function nameHits(bookName: string, team: TeamLike): boolean {
  const key = teamKey(bookName);
  if (!key) return false;
  const aliases = aliasesOf(team);
  if (aliases.has(key)) return true;
  // "Washington Mystics" vs ESPN "Washington Mystics" is exact; "Fever" alone is not enough unless it
  // is the whole ESPN short name.
  const short = teamKey(team.name ?? "");
  return short.length > 3 && key === short;
}

/** Matches one book event against a slate. Pure. */
export function matchEvent(event: BookEvent, games: MatchableGame[], known: Map<string, string> = new Map()): EventMatch | null {
  // External id learned from another book of the same fixture (betradar is the one they share). It
  // is trusted only when at least one of the book's names is on that game: a wrong manual pairing
  // must not propagate to every book sharing the id, and a name that says otherwise wins below.
  for (const [k, v] of Object.entries(event.externalIds)) {
    const gameId = known.get(`${k}:${v}`);
    const g = gameId ? games.find((x) => x.id === gameId) : undefined;
    if (!g) continue;
    const straight = nameHits(event.home, g.home) || nameHits(event.away, g.away);
    const crossed = nameHits(event.home, g.away) || nameHits(event.away, g.home);
    if (straight || crossed) return { gameId: g.id, matchedBy: "external", swapped: !straight && crossed };
  }
  const t = Date.parse(event.startsAt);
  const candidates = games.filter((g) => Math.abs(Date.parse(g.startsAt) - t) <= KICKOFF_TOLERANCE_MS);
  for (const g of candidates) {
    if (nameHits(event.home, g.home) && nameHits(event.away, g.away)) return { gameId: g.id, matchedBy: "names", swapped: false };
    if (nameHits(event.home, g.away) && nameHits(event.away, g.home)) return { gameId: g.id, matchedBy: "names", swapped: true };
  }
  return null;
}

/** A readable label for the unmatched list. */
export function describeEvent(event: BookEvent): string {
  return `${stripAccents(normaliseTeam(event.home))} × ${stripAccents(normaliseTeam(event.away))} (${event.startsAt.slice(0, 16).replace("T", " ")}Z)`;
}
