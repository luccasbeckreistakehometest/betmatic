import type { MetadataRoute } from "next";
import { SPORT_LANDINGS } from "@/lib/sport-landing";
import { listUpcomingGames } from "@/lib/server/predictions";
import { refreshConfig } from "@/lib/server/refresh-policy";
import { gamePageUrl, mergeSitemapGames, type SitemapGame } from "@/lib/server/sitemap-games";
import { getSlate, shiftKey, todayKey } from "@/lib/sources/espn";
import { SPORTS } from "@/lib/sports";
import { publicBaseUrl } from "@/lib/base-url";

// The game pages come from the database and the live slates, so this is rendered per request.
export const dynamic = "force-dynamic";

async function scheduledGames(days: string[]): Promise<SitemapGame[]> {
  // Same sports the product covers by default (tennis off unless CRON_SPORTS says otherwise).
  const sports = refreshConfig(process.env, SPORTS.map((s) => s.key)).sports;
  const slates = await Promise.all(
    sports.flatMap((sportKey) =>
      days.map((day) =>
        getSlate(day, false, sportKey)
          .then((games) => games.filter((g) => g.status === "scheduled").map((g) => ({ gameId: g.id, sportKey })))
          // A slow or failing slate must never take the sitemap down.
          .catch(() => [] as SitemapGame[]),
      ),
    ),
  );
  return slates.flat();
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = publicBaseUrl();
  const now = new Date();
  const pages = ["", "/prova", "/ferramentas", "/signup", ...SPORT_LANDINGS.map((s) => `/${s.slug.pt}`), ...SPORT_LANDINGS.map((s) => `/${s.slug.en}`)];
  const fixed = pages.flatMap((p) => [
    { url: `${base}${p}`, lastModified: now, changeFrequency: "daily" as const, priority: p === "" ? 1 : 0.7 },
    { url: `${base}${p}?lang=en`, lastModified: now, changeFrequency: "daily" as const, priority: 0.5 },
  ]);
  // "Palpite X x Y": every scheduled game on today's and tomorrow's slates, with or without tickets.
  const today = todayKey();
  const days = [today, shiftKey(today, 1)];
  const withTickets = listUpcomingGames(days).map((g) => ({ gameId: g.gameId, sportKey: g.sportKey, lastModified: g.generatedAt }));
  const games = mergeSitemapGames(withTickets, await scheduledGames(days)).flatMap((g) => {
    const lastModified = g.lastModified ? new Date(g.lastModified) : now;
    return [
      { url: gamePageUrl(base, g.gameId, g.sportKey), lastModified, changeFrequency: "hourly" as const, priority: 0.8 },
      { url: gamePageUrl(base, g.gameId, g.sportKey, "en"), lastModified, changeFrequency: "hourly" as const, priority: 0.6 },
    ];
  });
  return [...fixed, ...games];
}
