import { cached } from "@/lib/cache";
import { espnJson } from "@/lib/sources/espn-http";
import { parseLiveSnapshot, type LiveSnapshot } from "@/lib/live/snapshot";
import { getSport } from "@/lib/sports";

/**
 * ESPN's summary, re-read at most every 45 seconds per game whatever the number of viewers. It sits
 * in its own module because both the live panel (server/live.ts) and the props pipeline
 * (props/box-score.ts) read it, and server/live.ts already imports from the props pipeline.
 */
export async function getLiveSnapshot(sportKey: string, gameId: string): Promise<LiveSnapshot | null> {
  const sport = getSport(sportKey);
  if (sport.group !== "basketball" && sport.group !== "soccer") return null;
  const group = sport.group;
  return cached(`live-${sport.key}-${gameId}`, 45_000, async () => {
    try {
      const summary = await espnJson(`https://site.api.espn.com/apis/site/v2/sports/${sport.espnSport}/${sport.espnLeague}/summary?event=${gameId}`, { timeoutMs: 6000 });
      return parseLiveSnapshot(summary, gameId, group, sport.key === "wnba" ? 10 : 12);
    } catch {
      return null;
    }
  });
}
