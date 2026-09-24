import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-live-book-prices");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });

import type { BookAdapter, BookPrice } from "@/lib/sources/br-books/types";
import type { Game } from "@/lib/types";

const { cleanupBooks, ensureBooksSchema, liveBooksForGame, liveGames, livePricesForGame, persistPrices, pricesForGame, booksForGame, retireStaleLivePrices, runLiveBooksJob, setAdapterEnabled } = await import("@/lib/server/book-prices");
const { getDb } = await import("@/lib/server/db");

/**
 * The separation the whole in-play round exists for: a price read before the tip and a price read
 * with the ball up are two different numbers about two different games of chance, and this store
 * must never let one answer for the other.
 */
const TIP = new Date("2026-09-22T23:30:00Z");
const Q3 = new Date("2026-09-23T00:40:00Z");
const team = (id: string, abbr: string, name: string): Game["home"] => ({ id, abbreviation: abbr, name: name.split(" ").pop()!, displayName: name });
const GAME: Game = { id: "401857190", sportKey: "wnba", startsAt: TIP.toISOString(), status: "live", statusDetail: "", home: team("1", "WSH", "Washington Mystics"), away: team("2", "CONN", "Connecticut Sun") };
const EV = { key: "superbet:superbet:1", home: "Washington Mystics", away: "Connecticut Sun", startsAt: TIP.toISOString(), externalIds: { superbet: "1" }, sport: "basketball" as const };
const price = (p: Partial<BookPrice>, at: Date): BookPrice => ({ book: "Superbet", platform: "superbet", sport: "basketball", event: EV, market: "moneyline", side: "home", decimal: 1.9, fetchedAt: at.toISOString(), ...p });

const fake = (id: string, live: BookPrice[] | Error, servesLive = true): BookAdapter => ({
  id, book: id, platform: id, sports: ["wnba"], coverage: "test", hosts: [`${id}.example`],
  fetchBookOdds: () => Promise.resolve([]),
  ...(servesLive ? { fetchLiveOdds: () => (live instanceof Error ? Promise.reject(live) : Promise.resolve(live)), liveCoverage: "ao vivo: tudo" } : {}),
});

beforeAll(() => { ensureBooksSchema(); });

describe("the two populations never meet", () => {
  it("keeps a pre-game price and an in-play price on the same selection as two rows", () => {
    const before = new Date(TIP.getTime() - 3_600_000);
    persistPrices([price({ decimal: 1.07 }, before)], "wnba", [{ ...GAME, status: "scheduled" }], before);
    const saved = persistPrices([price({ decimal: 1.55, inPlay: true }, Q3)], "wnba", [GAME], Q3);
    expect(saved).toMatchObject({ rows: 1, changed: 1 });
    const rows = getDb().prepare("SELECT decimal, inPlay, current FROM book_prices WHERE eventKey = ? ORDER BY decimal").all(EV.key) as { decimal: number; inPlay: number; current: number }[];
    // Both are current: the in-play read did not retire the board the pre-game read stored.
    expect(rows).toEqual([{ decimal: 1.07, inPlay: 0, current: 1 }, { decimal: 1.55, inPlay: 1, current: 1 }]);
  });

  it("answers the in-play reader with the in-play price and nothing else", () => {
    const live = livePricesForGame("401857190", Q3);
    expect(live.map((p) => p.decimal)).toEqual([1.55]);
    expect(live.every((p) => p.inPlay === true)).toBe(true);
    expect(liveBooksForGame("401857190", Q3)).toMatchObject({ books: ["Superbet"], ageSeconds: 0 });
  });

  it("never lets an in-play row reach the pre-game reader, before or after the tip", () => {
    const early = new Date(TIP.getTime() - 3_600_000);
    expect(pricesForGame("401857190", early).map((p) => p.decimal)).toEqual([1.07]);
    // After the tip the pre-game reader has nothing at all — which is what it said before this round existed.
    expect(pricesForGame("401857190", Q3)).toEqual([]);
    expect(booksForGame("401857190", Q3)).toEqual({ books: [], fetchedAt: null });
  });

  it("moves an in-play price without touching the pre-game history, and keeps its trail", () => {
    const later = new Date(Q3.getTime() + 60_000);
    persistPrices([price({ decimal: 1.62, inPlay: true }, later)], "wnba", [GAME], later);
    expect(livePricesForGame("401857190", later).map((p) => p.decimal)).toEqual([1.62]);
    const trail = getDb().prepare("SELECT decimal, inPlay, current FROM book_prices WHERE eventKey = ? AND inPlay = 1 ORDER BY id").all(EV.key) as { decimal: number; current: number }[];
    expect(trail.map((r) => [r.decimal, r.current])).toEqual([[1.55, 0], [1.62, 1]]);
    expect((getDb().prepare("SELECT current FROM book_prices WHERE eventKey = ? AND inPlay = 0").get(EV.key) as { current: number }).current).toBe(1);
  });
});

describe("a live price that is no longer current is not served at all", () => {
  it("withholds a price older than the freshness window rather than passing it off as now", () => {
    const at = new Date(Q3.getTime() + 60_000);
    const stale = new Date(at.getTime() + 91_000);
    expect(livePricesForGame("401857190", stale)).toEqual([]);
    expect(liveBooksForGame("401857190", stale)).toEqual({ books: [], seenAt: null, ageSeconds: null });
    // Inside the window it is still the price: the boundary is a rule, not a guess.
    expect(livePricesForGame("401857190", new Date(at.getTime() + 89_000)).map((p) => p.decimal)).toEqual([1.62]);
  });

  it("retires an in-play row nobody has confirmed, and a finished game keeps none", () => {
    const hourLater = new Date(Q3.getTime() + 61 * 60_000);
    expect(retireStaleLivePrices(hourLater, 30)).toBe(1);
    expect(getDb().prepare("SELECT COUNT(*) n FROM book_prices WHERE inPlay = 1 AND current = 1").get()).toEqual({ n: 0 });
  });

  it("does not let kickoff retire an in-play row, which only exists after it", () => {
    const at = new Date(Q3.getTime() + 2 * 60_000);
    persistPrices([price({ decimal: 1.7, inPlay: true }, at)], "wnba", [GAME], at);
    const out = cleanupBooks(at, 14, 24, 30);
    expect(out.retiredLive).toBe(0);
    expect(livePricesForGame("401857190", at).map((p) => p.decimal)).toEqual([1.7]);
    // And the pre-game board is retired by the same call, because its game has started.
    expect((getDb().prepare("SELECT current FROM book_prices WHERE eventKey = ? AND inPlay = 0").get(EV.key) as { current: number }).current).toBe(0);
  });
});

describe("runLiveBooksJob", () => {
  const slate = async (day: string, sportKey: string): Promise<Game[]> => (sportKey !== "wnba" ? [] : day === "20260922"
    ? [GAME, { ...GAME, id: "done", status: "final" as const }, { ...GAME, id: "soon", status: "scheduled" as const }]
    : []);

  it("reads only the games that are under way", async () => {
    const games = await liveGames(["wnba"], Q3, slate);
    expect(games.get("wnba")?.map((g) => g.id)).toEqual(["401857190"]);
  });

  it("asks only the books that serve an in-play feed, and stores their rows as in-play", async () => {
    const at = new Date(Q3.getTime() + 10 * 60_000);
    const serves = fake("superbet", [price({ decimal: 1.44, inPlay: true }, at)]);
    const doesNot = fake("sportingbet", [], false);
    const out = await runLiveBooksJob({ now: at, sports: ["wnba"], adapters: [serves, doesNot], slate });
    expect(out.status).toBe("ok");
    expect(out.adapters.map((a) => a.id)).toEqual(["superbet"]);
    expect(out.rows).toBe(1);
    expect(livePricesForGame("401857190", at).map((p) => p.decimal)).toEqual([1.44]);
  });

  it("drops a row the book returned for a game that has not started", async () => {
    const at = new Date(Q3.getTime() + 12 * 60_000);
    const future = { ...EV, key: "superbet:superbet:2", startsAt: new Date(at.getTime() + 3_600_000).toISOString() };
    const adapter = fake("superbet", [price({ event: future, decimal: 2.2, inPlay: true }, at)]);
    const out = await runLiveBooksJob({ now: at, sports: ["wnba"], adapters: [adapter], slate });
    expect(out.rows).toBe(0);
    expect(getDb().prepare("SELECT COUNT(*) n FROM book_prices WHERE eventKey = ?").get(future.key)).toEqual({ n: 0 });
  });

  it("costs one scoreboard read and writes nothing when no game is in play", async () => {
    const out = await runLiveBooksJob({ now: Q3, sports: ["wnba"], adapters: [fake("superbet", [])], slate: async () => [] });
    expect(out).toMatchObject({ status: "skipped", note: "no game in play", rows: 0 });
  });

  it("records the in-play health of a book apart from its pre-game health", async () => {
    const at = new Date(Q3.getTime() + 15 * 60_000);
    const adapter = fake("superbet", new Error("live feed down"));
    const out = await runLiveBooksJob({ now: at, sports: ["wnba"], adapters: [adapter], slate });
    expect(out.status).toBe("error");
    const row = getDb().prepare("SELECT lastStatus, liveLastStatus FROM book_adapter_status WHERE id = 'superbet'").get() as { lastStatus: string; liveLastStatus: string };
    expect(row.liveLastStatus).toBe("error");
    // The pre-game column was never touched by the in-play round.
    expect(row.lastStatus).toBe("idle");
  });

  it("skips entirely when no enabled adapter has an in-play feed", async () => {
    setAdapterEnabled("sportingbet", true);
    const out = await runLiveBooksJob({ now: Q3, sports: ["wnba"], env: { BR_BOOKS: "sportingbet" }, slate });
    expect(out).toMatchObject({ status: "skipped", rows: 0 });
    expect(out.note).toContain("in-play feed");
    setAdapterEnabled("sportingbet", null);
  });
});
