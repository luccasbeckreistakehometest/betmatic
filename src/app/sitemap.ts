import type { MetadataRoute } from "next";
import { SPORT_LANDINGS } from "@/lib/sport-landing";
import { listUpcomingGames } from "@/lib/server/predictions";
import { shiftKey, todayKey } from "@/lib/sources/espn";

// The game pages come from the database, so this is rendered per request rather than at build.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://betmatic.marqa.online";
  const now = new Date();
  const pages = ["", "/prova", "/ferramentas", "/signup", ...SPORT_LANDINGS.map((s) => `/${s.slug.pt}`), ...SPORT_LANDINGS.map((s) => `/${s.slug.en}`)];
  const fixed = pages.flatMap((p) => [
    { url: `${base}${p}`, lastModified: now, changeFrequency: "daily" as const, priority: p === "" ? 1 : 0.7 },
    { url: `${base}${p}?lang=en`, lastModified: now, changeFrequency: "daily" as const, priority: 0.5 },
  ]);
  // "Palpite X x Y": every game with tickets on today's and tomorrow's slates.
  const today = todayKey();
  const games = listUpcomingGames([today, shiftKey(today, 1)]).flatMap((g) => [
    { url: `${base}/jogo/${g.gameId}`, lastModified: new Date(g.generatedAt), changeFrequency: "hourly" as const, priority: 0.8 },
    { url: `${base}/jogo/${g.gameId}?lang=en`, lastModified: new Date(g.generatedAt), changeFrequency: "hourly" as const, priority: 0.6 },
  ]);
  return [...fixed, ...games];
}
