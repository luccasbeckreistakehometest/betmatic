import { describe, expect, it } from "vitest";
import { gamePageUrl, mergeSitemapGames } from "@/lib/server/sitemap-games";

describe("sitemap game pages", () => {
  it("always carries the sport, so a game without tickets still resolves", () => {
    expect(gamePageUrl("https://x.y", "401", "soccer-bra")).toBe("https://x.y/jogo/401?sport=soccer-bra");
    expect(gamePageUrl("https://x.y", "401", "soccer-bra", "en")).toBe("https://x.y/jogo/401?sport=soccer-bra&lang=en");
  });
  it("lists every scheduled game once, keeping the ticketed entry (it has a real lastModified)", () => {
    const merged = mergeSitemapGames(
      [{ gameId: "1", sportKey: "nba", lastModified: "2026-09-17T10:00:00Z" }],
      [{ gameId: "1", sportKey: "nba" }, { gameId: "2", sportKey: "soccer-esp" }, { gameId: "2", sportKey: "soccer-esp" }],
    );
    expect(merged).toEqual([
      { gameId: "1", sportKey: "nba", lastModified: "2026-09-17T10:00:00Z" },
      { gameId: "2", sportKey: "soccer-esp" },
    ]);
  });
});
