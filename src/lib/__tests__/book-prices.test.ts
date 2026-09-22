import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-book-prices");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });

import type { BookAdapter, BookPrice } from "@/lib/sources/br-books/types";
import type { Game } from "@/lib/types";

const { activeAdapters, assignEventGame, booksForGame, booksStats, ensureBooksSchema, listAdapterStatus, listCoverage, listUnmatchedEvents, persistPrices, priceHistory, pricesForGame, runBooksJob, setAdapterEnabled, upcomingGames } = await import("@/lib/server/book-prices");
const { getDb } = await import("@/lib/server/db");

const NOW = new Date("2026-09-22T12:00:00Z");
const team = (id: string, abbr: string, name: string): Game["home"] => ({ id, abbreviation: abbr, name: name.split(" ").pop()!, displayName: name });
const GAME: Game = { id: "401857190", sportKey: "wnba", startsAt: "2026-09-22T23:30:00Z", status: "scheduled", statusDetail: "", home: team("1", "WSH", "Washington Mystics"), away: team("2", "CONN", "Connecticut Sun") };
const LATER: Game = { ...GAME, id: "401857199", startsAt: "2026-09-25T23:30:00Z" };
const event = (key: string, home: string, away: string, externalIds: Record<string, string> = {}) => ({ key, home, away, startsAt: "2026-09-22T23:30:00Z", externalIds, sport: "basketball" as const });
const price = (book: string, ev: ReturnType<typeof event>, p: Partial<BookPrice>): BookPrice => ({ book, platform: book.toLowerCase(), sport: "basketball", event: ev, market: "player_prop", decimal: 1.9, fetchedAt: NOW.toISOString(), ...p });

const fake = (id: string, rows: BookPrice[] | Error | "hang"): BookAdapter => ({
  id, book: id, platform: id, sports: ["wnba"], coverage: "test",
  fetchBookOdds: () => rows === "hang" ? new Promise(() => {}) : rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows),
});

describe("book_prices store", () => {
  beforeAll(() => { ensureBooksSchema(); });

  it("creates the tables idempotently on a live database", () => {
    ensureBooksSchema();
    const tables = (getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'book_%'").all() as { name: string }[]).map((t) => t.name).sort();
    expect(tables).toEqual(["book_adapter_status", "book_events", "book_prices", "book_team_aliases"]);
  });

  it("matches events to the slate, keeps history only when a price moves, and retires pulled lines", () => {
    const ev = event("superbet:superbet:1", "Washington Mystics", "Connecticut Sun", { betradar: "68096448", superbet: "1" });
    const first = persistPrices([
      price("Superbet", ev, { player: "Shakira Austin", stat: "points", line: 17.5, side: "over", decimal: 1.92, kind: "total" }),
      price("Superbet", ev, { player: "Shakira Austin", stat: "points", line: 17.5, side: "under", decimal: 1.78, kind: "total" }),
      price("Superbet", ev, { market: "moneyline", side: "home", decimal: 1.07 }),
    ], "wnba", [GAME], NOW);
    expect(first).toEqual({ events: 1, matched: 1, rows: 3, changed: 3 });

    const later = new Date(NOW.getTime() + 15 * 60_000);
    const second = persistPrices([
      price("Superbet", ev, { player: "Shakira Austin", stat: "points", line: 17.5, side: "over", decimal: 1.95, kind: "total", fetchedAt: later.toISOString() }),
      price("Superbet", ev, { player: "Shakira Austin", stat: "points", line: 17.5, side: "under", decimal: 1.78, kind: "total", fetchedAt: later.toISOString() }),
    ], "wnba", [GAME], later);
    expect(second).toMatchObject({ rows: 2, changed: 1 });

    const current = pricesForGame("401857190");
    expect(current).toHaveLength(2);
    expect(current.find((p) => p.side === "over")?.decimal).toBe(1.95);
    // The moneyline was not posted on the second read: it is no longer current.
    expect(current.some((p) => p.market === "moneyline")).toBe(false);
    const trail = priceHistory(ev.key, { book: "Superbet", market: "player_prop", player: "Shakira Austin", stat: "points", line: 17.5, side: "over" });
    expect(trail.map((t) => [t.decimal, t.current])).toEqual([[1.92, false], [1.95, true]]);
    expect(booksForGame("401857190")).toEqual({ books: ["Superbet"], fetchedAt: later.toISOString() });
  });

  it("lets a second book inherit the match through the betradar id, and flips a swapped listing at read time", () => {
    const ev = event("betfair-exchange:betfair:9", "Connecticut Sun", "Washington Mystics", { betradar: "68096448", betfair: "9" });
    const out = persistPrices([
      { ...price("Betfair Exchange", ev, { market: "moneyline", side: "home", decimal: 9.6, lay: 11 }), platform: "betfair-exchange" },
      { ...price("Betfair Exchange", ev, { market: "spread", side: "home", line: -35.5, decimal: 1.01 }), platform: "betfair-exchange" },
    ], "wnba", [GAME], NOW);
    expect(out.matched).toBe(1);
    const rows = pricesForGame("401857190").filter((p) => p.book === "Betfair Exchange");
    // The Sun were the book's home; ESPN's home is the Mystics, so the Sun's prices become the away side.
    expect(rows.find((p) => p.market === "moneyline")).toMatchObject({ side: "away", decimal: 9.6, lay: 11 });
    expect(rows.find((p) => p.market === "spread")).toMatchObject({ side: "away", line: -35.5 });
  });

  it("lists what could not be matched and takes a manual assignment", () => {
    const ev = event("kambi:ktobr:5", "Mistiques de Washington", "Sol de Connecticut", { kambi: "5" });
    persistPrices([price("KTO", ev, { market: "moneyline", side: "home", decimal: 1.1 })], "wnba", [GAME], NOW);
    const unmatched = listUnmatchedEvents();
    expect(unmatched.map((u) => u.key)).toContain("kambi:ktobr:5");
    expect(unmatched.find((u) => u.key === "kambi:ktobr:5")).toMatchObject({ book: "KTO", prices: 1 });
    expect(assignEventGame("kambi:ktobr:5", "401857190")).toBe(true);
    expect(listUnmatchedEvents().some((u) => u.key === "kambi:ktobr:5")).toBe(false);
    expect(pricesForGame("401857190").some((p) => p.book === "KTO")).toBe(true);
    // A later automatic read never undoes the hand match.
    persistPrices([price("KTO", ev, { market: "moneyline", side: "home", decimal: 1.12 })], "wnba", [LATER], NOW);
    expect(pricesForGame("401857190").find((p) => p.book === "KTO")?.decimal).toBe(1.12);
    expect(listCoverage().find((c) => c.gameId === "401857190")?.books).toEqual(["Betfair Exchange", "KTO", "Superbet"]);
    expect(booksStats().matched).toBeGreaterThanOrEqual(3);
  });

  it("follows BR_BOOKS unless the admin switched a book by hand", () => {
    expect(activeAdapters({ BR_BOOKS: "superbet,kambi:kto" }).map((a) => a.id)).toEqual(["superbet", "kambi:kto"]);
    expect(setAdapterEnabled("kambi:kto", false)).toBe(true);
    expect(setAdapterEnabled("betnacional", true)).toBe(true);
    expect(setAdapterEnabled("nope", true)).toBe(false);
    expect(activeAdapters({ BR_BOOKS: "superbet,kambi:kto" }).map((a) => a.id)).toEqual(["superbet", "betnacional"]);
    expect(listAdapterStatus({ BR_BOOKS: "superbet" }).find((a) => a.id === "betnacional")).toMatchObject({ active: true, enabled: 1 });
    setAdapterEnabled("kambi:kto", null);
    setAdapterEnabled("betnacional", null);
  });

  it("looks at the next two days' scheduled games only", async () => {
    const slate = async (day: string) => (day === "20260922" ? [GAME, { ...GAME, id: "old", startsAt: "2026-09-22T01:00:00Z" }, { ...GAME, id: "live", status: "live" as const }] : day === "20260923" ? [{ ...GAME, id: "tomorrow", startsAt: "2026-09-23T23:00:00Z" }] : [LATER]);
    const games = await upcomingGames(["wnba"], NOW, 48, slate);
    expect(games.get("wnba")?.map((g) => g.id)).toEqual(["401857190", "tomorrow"]);
  });
});

describe("runBooksJob", () => {
  const slate = async (day: string) => (day === "20260922" ? [GAME] : []);

  it("runs every adapter in isolation: one wall, one failure and one hang never stop the others", async () => {
    const ev = event("superbet:superbet:77", "Washington Mystics", "Connecticut Sun", { superbet: "77" });
    const started = event("superbet:superbet:78", "Washington Mystics", "Connecticut Sun", { superbet: "78" });
    const { BookWallError } = await import("@/lib/sources/br-books/types");
    const result = await runBooksJob({
      now: NOW, sports: ["wnba"], slate,
      env: { BOOKS_ADAPTER_TIMEOUT_MS: "5000", BOOKS_HORIZON_HOURS: "48" },
      adapters: [
        fake("a-ok", [price("a-ok", ev, { market: "total", side: "over", line: 150.5, decimal: 1.4 }), price("a-ok", { ...started, startsAt: "2026-09-22T11:00:00Z" }, { market: "total", side: "over", line: 150.5, decimal: 1.4 })]),
        fake("b-wall", new BookWallError("wall.example", 403)),
        fake("c-error", new Error("boom")),
        { ...fake("d-hang", "hang"), fetchBookOdds: () => new Promise((resolve) => setTimeout(() => resolve([]), 8_000)) },
        fake("e-empty", []),
      ],
    });
    expect(result.status).toBe("ok");
    expect(result.adapters.map((a) => [a.id, a.status])).toEqual([["a-ok", "ok"], ["b-wall", "wall"], ["c-error", "error"], ["d-hang", "timeout"], ["e-empty", "empty"]]);
    // The already-started event's row was dropped before persisting: in-play is a later round.
    expect(result.rows).toBe(1);
    expect(result.games).toBe(1);
    expect(result.adapters.find((a) => a.id === "c-error")?.error).toBe("boom");
    const ops = getDb().prepare("SELECT scope, level FROM ops_log WHERE scope LIKE 'job.books.%' ORDER BY scope").all() as { scope: string; level: string }[];
    expect(ops).toEqual(expect.arrayContaining([{ scope: "job.books.b-wall", level: "warn" }, { scope: "job.books.c-error", level: "error" }, { scope: "job.books.d-hang", level: "error" }]));
  }, 15_000);

  it("is an error only when something failed and nothing was written, and a skip when nothing is enabled", async () => {
    const bad = await runBooksJob({ now: NOW, sports: ["wnba"], slate, adapters: [fake("x", new Error("down"))] });
    expect(bad.status).toBe("error");
    const none = await runBooksJob({ now: NOW, sports: ["wnba"], slate, adapters: [] });
    expect(none.status).toBe("skipped");
  });
});
