/**
 * The public game pages the sitemap advertises. Tickets are generated on demand, so most upcoming
 * games have none yet — listing only games with tickets would leave the "Palpite X x Y" pages
 * invisible until someone opened each game. Every scheduled game on the configured slates gets a
 * URL; the sport travels in the query string because a game without tickets has no stored sport,
 * and the page (and its canonical) needs it to resolve.
 */
export interface SitemapGame { gameId: string; sportKey: string; lastModified?: string }

export function gamePageUrl(base: string, gameId: string, sportKey: string, lang: "pt" | "en" = "pt"): string {
  const url = `${base}/jogo/${gameId}?sport=${encodeURIComponent(sportKey)}`;
  return lang === "en" ? `${url}&lang=en` : url;
}

/** Games with tickets first (they carry a real lastModified), then scheduled ones not already listed. */
export function mergeSitemapGames(withTickets: SitemapGame[], scheduled: SitemapGame[]): SitemapGame[] {
  const seen = new Set<string>();
  const out: SitemapGame[] = [];
  for (const g of [...withTickets, ...scheduled]) {
    if (seen.has(g.gameId)) continue;
    seen.add(g.gameId);
    out.push(g);
  }
  return out;
}
