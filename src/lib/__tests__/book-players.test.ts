import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { GameDetail, PlayerHistory } from "@/lib/types";
import type { PostedProp } from "@/lib/sources/espn-props";

/**
 * The players the licensed books priced get measured too.
 *
 * On 24/09/2026 every generation of the night said the same thing in its own words — "apenas três
 * jogadoras têm histórico medido e preço publicado", "só duas jogadoras". The cause was that the
 * player list was built only from ESPN's prop feed, so the books' own players never had a game log
 * fetched: a published price with no measured history behind it cannot carry a leg, and the night
 * had almost nothing to choose from. In one game the two lists shared a single name.
 */
const LOGS = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/lib/__tests__/fixtures/wnba-gamelogs-20260921.json"), "utf8")) as Record<string, PlayerHistory>;
const historyCalls: string[] = [];

vi.mock("@/lib/server/live-snapshot", () => ({ getLiveSnapshot: vi.fn() }));
vi.mock("@/lib/sources/espn", async (orig) => ({
  ...(await orig<typeof import("@/lib/sources/espn")>()),
  getPlayerHistory: async (...args: unknown[]): Promise<PlayerHistory | null> => { historyCalls.push(String(args[1])); return LOGS[String(args[1])] ?? null; },
  getSeasonRole: async () => null,
}));

const { buildPropCandidates, BOOK_PLAYER_CAP } = await import("@/lib/props/candidates");

const ID = { kuier: "4790266", thomas: "2529140", ogunbowale: "3904577", bueckers: "4433730" };
const athlete = (id: string, name: string) => ({ id, name });
const detail: GameDetail = {
  game: {
    id: "401857207", sportKey: "wnba", startsAt: "2026-09-22T02:00Z", status: "scheduled", statusDetail: "",
    home: { id: "11", abbreviation: "PHX", name: "Mercury", displayName: "Phoenix Mercury" },
    away: { id: "3", abbreviation: "DAL", name: "Wings", displayName: "Dallas Wings" },
  },
  injuries: [],
  teamStats: { home: [], away: [] }, books: [{ provider: "DraftKings", details: "DAL -5.5", spread: 5.5, overUnder: 173.5 }], ats: [], leaders: [], lastMeetings: [],
  rosters: [
    { teamAbbreviation: "DAL", players: [], athletes: [athlete(ID.kuier, "Awak Kuier"), athlete(ID.ogunbowale, "Arike Ogunbowale"), athlete(ID.bueckers, "Paige Bueckers")] },
    { teamAbbreviation: "PHX", players: [], athletes: [athlete(ID.thomas, "Alyssa Thomas")] },
  ],
};
const posted = (athleteId: string, marketKey: string, line: number): PostedProp => ({
  athleteId, marketKey, line, side: "over", decimal: 1.9, openDecimal: null, openLine: null, otherDecimal: null, noVigFair: 0.5, kind: "total", book: "DraftKings", updatedAt: null,
});
// ESPN prices two players. The books, in the real night, priced others.
const feed = { status: "ok" as const, props: [posted(ID.kuier, "pra", 6.5), posted(ID.thomas, "points", 15.5)] };

const run = (alsoMeasure?: string[]) =>
  buildPropCandidates(detail, { feed, box: null, maxPlayers: 12, limit: 80, ...(alsoMeasure ? { alsoMeasure } : {}) });

describe("players priced by the licensed books", () => {
  it("are measured even when ESPN's feed never posted them", async () => {
    historyCalls.length = 0;
    const without = await run();
    expect(without.players.map((p) => p.name).sort()).toEqual(["Alyssa Thomas", "Awak Kuier"]);

    historyCalls.length = 0;
    const withBooks = await run(["Paige Bueckers"]);
    expect(withBooks.players.map((p) => p.name).sort()).toEqual(["Alyssa Thomas", "Awak Kuier", "Paige Bueckers"]);
    // The point of the change: her game log is actually fetched, which is what a measured leg needs.
    expect(historyCalls).toContain(ID.bueckers);
  });

  it("matches a book's spelling to the roster rather than demanding it exactly", async () => {
    // Books print accents, initials and suffixes their own way; the roster is the source of truth.
    const set = await run(["P. Bueckers"]);
    expect(set.players.map((p) => p.name)).toContain("Paige Bueckers");
  });

  it("never adds the same player twice, whichever list named her", async () => {
    const set = await run(["Awak Kuier", "Awak Kuier", "Paige Bueckers"]);
    const names = set.players.map((p) => p.name);
    expect(names.filter((n) => n === "Awak Kuier")).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
  });

  it("ignores a name no roster carries instead of inventing a player", async () => {
    const set = await run(["Jogadora Que Nao Existe"]);
    expect(set.players.map((p) => p.name).sort()).toEqual(["Alyssa Thomas", "Awak Kuier"]);
  });

  it("stops at the cap, because each extra player is another game-log fetch", async () => {
    const many = Array.from({ length: BOOK_PLAYER_CAP + 5 }, (_, i) => `Fulana ${i}`);
    const set = await run(["Paige Bueckers", ...many]);
    expect(set.players.length).toBeLessThanOrEqual(2 + BOOK_PLAYER_CAP);
    expect(set.players.map((p) => p.name)).toContain("Paige Bueckers");
  });

  it("changes nothing when the books have no prices on the game", async () => {
    const before = await run();
    const after = await run([]);
    expect(after.players.map((p) => p.name)).toEqual(before.players.map((p) => p.name));
  });
});
