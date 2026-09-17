import { getSlate } from "@/lib/sources/espn";
import { DEFAULT_SPORT, DEFAULT_SPORT_ORDER, SOLD_SPORTS } from "@/lib/sports";

export const SPORT_COOKIE = "bm_sport";

/** A sport key the visitor may land on, or null. */
export function soldSportKey(value: string | undefined | null): string | null {
  return value && SOLD_SPORTS.some((s) => s.key === value) ? value : null;
}

/**
 * The sport to open when the visitor named none: the first in the preferred order that has games on
 * the day. NBA has a four-month offseason, so a fixed default greets new users with an empty page.
 */
export async function defaultSportKey(dateKey: string): Promise<string> {
  const results = await Promise.all(
    DEFAULT_SPORT_ORDER.map(async (key) => ({ key, games: await getSlate(dateKey, false, key).catch(() => []) })),
  );
  const withGames = results.find((r) => r.games.some((g) => g.status !== "final")) ?? results.find((r) => r.games.length > 0);
  return withGames?.key ?? DEFAULT_SPORT;
}
