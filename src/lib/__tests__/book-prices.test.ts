import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DIR = path.join(process.cwd(), "data", "unit-book-prices");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });

import type { BookAdapter, BookPrice } from "@/lib/sources/br-books/types";
import type { Game } from "@/lib/types";

const { activeAdapters, assignEventGame, booksForGame, booksForGames, booksStats, cleanupBooks, ensureBooksSchema, listAdapterStatus, listCoverage, listUnmatchedEvents, persistPrices, priceHistory, pricesForGame, pricesForGames, runBooksJob, setAdapterEnabled, upcomingGames } = await import("@/lib/server/book-prices");
const { gamePrices, slatePrices, resetGamePricesMemo } = await import("@/lib/server/book-compare");
const { getDb } = await import("@/lib/server/db");
const { BookWallError } = await import("@/lib/sources/br-books/types");

const NOW = new Date("2026-09-22T12:00:00Z");
const team = (id: string, abbr: string, name: string): Game["home"] => ({ id, abbreviation: abbr, name: name.split(" ").pop()!, displayName: name });
const GAME: Game = { id: "401857190", sportKey: "wnba", startsAt: "2026-09-22T23:30:00Z", status: "scheduled", statusDetail: "", home: team("1", "WSH", "Washington Mystics"), away: team("2", "CONN", "Connecticut Sun") };
const LATER: Game = { ...GAME, id: "401857199", startsAt: "2026-09-25T23:30:00Z" };
const event = (key: string, home: string, away: string, externalIds: Record<string, string> = {}, startsAt = "2026-09-22T23:30:00Z") => ({ key, home, away, startsAt, externalIds, sport: "basketball" as const });
const price = (book: string, ev: ReturnType<typeof event>, p: Partial<BookPrice>): BookPrice => ({ book, platform: book.toLowerCase(), sport: "basketball", event: ev, market: "player_prop", decimal: 1.9, fetchedAt: NOW.toISOString(), ...p });

const fake = (id: string, rows: BookPrice[] | Error | "hang", hosts = [`${id}.example`]): BookAdapter => ({
  id, book: id, platform: id, sports: ["wnba"], coverage: "test", hosts,
  fetchBookOdds: () => rows === "hang" ? new Promise(() => {}) : rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows),
});
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new Error("aborted"));
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); }, { once: true });
});

describe("book_prices store", () => {
  beforeAll(() => { ensureBooksSchema(); });

  it("creates the tables, and a second process running the same DDL against the live file is a no-op", () => {
    ensureBooksSchema();
    const tables = (getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'book_%'").all() as { name: string }[]).map((t) => t.name).sort();
    expect(tables).toEqual(["book_adapter_status", "book_events", "book_prices", "book_team_aliases"]);
    // The same schema step from another process (the way `next build` workers and the cron hit it).
    const script = path.join(DIR, "ddl-check.mts");
    fs.writeFileSync(script, `process.env.DATA_DIR = ${JSON.stringify(DIR)};\nprocess.env.AUTH_SECRET = "test-secret-that-is-long-enough";\nconst m = await import("@/lib/server/book-prices");\nm.ensureBooksSchema();\nconsole.log("ok");\nprocess.exit(0);\n`);
    const r = spawnSync(process.execPath, [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), script], { encoding: "utf8", cwd: process.cwd(), timeout: 60_000 });
    expect(r.stdout.trim(), r.stderr).toBe("ok");
    const indexes = (getDb().prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_book_%'").all() as { name: string }[]).map((t) => t.name).sort();
    expect(indexes).toEqual(["idx_book_events_game", "idx_book_events_starts", "idx_book_prices_current", "idx_book_prices_event", "idx_book_prices_key3", "idx_book_prices_live"]);
  }, 60_000);

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

    const current = pricesForGame("401857190", later);
    expect(current).toHaveLength(2);
    expect(current.find((p) => p.side === "over")?.decimal).toBe(1.95);
    // The moneyline was not posted on the second read: it is no longer current.
    expect(current.some((p) => p.market === "moneyline")).toBe(false);
    const trail = priceHistory(ev.key, { book: "Superbet", market: "player_prop", player: "Shakira Austin", stat: "points", line: 17.5, side: "over" });
    expect(trail.map((t) => [t.decimal, t.current])).toEqual([[1.92, false], [1.95, true]]);
    expect(booksForGame("401857190", later)).toEqual({ books: ["Superbet"], fetchedAt: later.toISOString() });
  });

  it("keeps the selection's ids as JSON, gives them to an unchanged price stored before they existed, and reads them back", () => {
    const ev = event("sportingbet:sportingbet:19919149", "Washington Mystics", "Connecticut Sun", { sportingbet: "19919149", betradar: "68096448" });
    const spread = (at: Date, ref?: BookPrice["ref"]) => [{ ...price("Sportingbet", ev, { market: "spread", side: "away", line: 14.5, decimal: 1.95, fetchedAt: at.toISOString(), ref }), platform: "sportingbet" }];
    const t1 = new Date(NOW.getTime() + 60_000), t2 = new Date(NOW.getTime() + 120_000);
    persistPrices(spread(t1), "wnba", [GAME], t1);
    expect(pricesForGame("401857190", t1).find((p) => p.book === "Sportingbet")?.ref).toBeUndefined();
    // The same price read again, now with its ids: no new row, the ids land on the current one.
    expect(persistPrices(spread(t2, { eventId: "19919149", marketId: "1560207544", outcomeId: "2301308044" }), "wnba", [GAME], t2)).toMatchObject({ rows: 1, changed: 0 });
    const row = pricesForGame("401857190", t2).find((p) => p.book === "Sportingbet")!;
    expect(row.ref).toEqual({ eventId: "19919149", marketId: "1560207544", outcomeId: "2301308044" });
    expect(getDb().prepare("SELECT COUNT(*) n FROM book_prices WHERE book = 'Sportingbet'").get()).toEqual({ n: 1 });
  });

  it("keys a price by its kind, so an over/under pair and an N+ rung at the same line never churn each other", () => {
    const ev = event("superbet:superbet:1", "Washington Mystics", "Connecticut Sun", { betradar: "68096448", superbet: "1" });
    const both = (at: Date) => [
      price("Superbet", ev, { player: "Kiki Iriafen", stat: "points", line: 17.5, side: "over", decimal: 2.05, kind: "total", fetchedAt: at.toISOString() }),
      price("Superbet", ev, { player: "Kiki Iriafen", stat: "points", line: 17.5, side: "over", decimal: 2.2, kind: "milestone", fetchedAt: at.toISOString() }),
    ];
    const t1 = new Date(NOW.getTime() + 30 * 60_000), t2 = new Date(NOW.getTime() + 45 * 60_000);
    expect(persistPrices(both(t1), "wnba", [GAME], t1)).toMatchObject({ rows: 2, changed: 2 });
    // The same two prices again: nothing is retired, nothing is inserted, no history is fabricated.
    expect(persistPrices(both(t2), "wnba", [GAME], t2)).toMatchObject({ rows: 2, changed: 0 });
    const rows = getDb().prepare("SELECT kind, decimal, current FROM book_prices WHERE player = 'Kiki Iriafen' ORDER BY kind").all() as { kind: string; decimal: number; current: number }[];
    expect(rows).toEqual([{ kind: "milestone", decimal: 2.2, current: 1 }, { kind: "total", decimal: 2.05, current: 1 }]);
    expect(priceHistory(ev.key, { book: "Superbet", market: "player_prop", player: "Kiki Iriafen", stat: "points", line: 17.5, side: "over", kind: "milestone" })).toHaveLength(1);
  });

  it("lets a second book inherit the match through the betradar id, and flips a swapped listing at read time", () => {
    const ev = event("betfair-exchange:betfair:9", "Connecticut Sun", "Washington Mystics", { betradar: "68096448", betfair: "9" });
    const out = persistPrices([
      { ...price("Betfair Exchange", ev, { market: "moneyline", side: "home", decimal: 9.6, lay: 11 }), platform: "betfair-exchange" },
      { ...price("Betfair Exchange", ev, { market: "spread", side: "home", line: -35.5, decimal: 1.01 }), platform: "betfair-exchange" },
    ], "wnba", [GAME], NOW);
    expect(out.matched).toBe(1);
    const rows = pricesForGame("401857190", NOW).filter((p) => p.book === "Betfair Exchange");
    // The Sun were the book's home; ESPN's home is the Mystics, so the Sun's prices become the away side.
    expect(rows.find((p) => p.market === "moneyline")).toMatchObject({ side: "away", decimal: 9.6, lay: 11 });
    expect(rows.find((p) => p.market === "spread")).toMatchObject({ side: "away", line: -35.5 });
    // A later read that cannot match (a slate without the game) keeps the match AND the swap.
    persistPrices([{ ...price("Betfair Exchange", ev, { market: "moneyline", side: "home", decimal: 9.8, lay: 11 }), platform: "betfair-exchange" }], "wnba", [LATER], NOW);
    expect(getDb().prepare("SELECT gameId, swapped FROM book_events WHERE key = ?").get(ev.key)).toEqual({ gameId: "401857190", swapped: 1 });
    expect(pricesForGame("401857190", NOW).find((p) => p.book === "Betfair Exchange" && p.market === "moneyline")).toMatchObject({ side: "away", decimal: 9.8 });
  });

  it("lists what could not be matched and takes a manual assignment", () => {
    const ev = event("kambi:ktobr:5", "Mistiques de Washington", "Sol de Connecticut", { kambi: "5" });
    persistPrices([price("KTO", ev, { market: "moneyline", side: "home", decimal: 1.1 })], "wnba", [GAME], NOW);
    const unmatched = listUnmatchedEvents(60, NOW);
    expect(unmatched.map((u) => u.key)).toContain("kambi:ktobr:5");
    expect(unmatched.find((u) => u.key === "kambi:ktobr:5")).toMatchObject({ book: "KTO", prices: 1 });
    expect(assignEventGame("kambi:ktobr:5", "401857190")).toBe(true);
    expect(listUnmatchedEvents(60, NOW).some((u) => u.key === "kambi:ktobr:5")).toBe(false);
    expect(pricesForGame("401857190", NOW).some((p) => p.book === "KTO")).toBe(true);
    // A later automatic read never undoes the hand match.
    persistPrices([price("KTO", ev, { market: "moneyline", side: "home", decimal: 1.12 })], "wnba", [LATER], NOW);
    expect(pricesForGame("401857190", NOW).find((p) => p.book === "KTO")?.decimal).toBe(1.12);
    expect(listCoverage(40, NOW).find((c) => c.gameId === "401857190")?.books).toEqual(["Betfair Exchange", "KTO", "Sportingbet", "Superbet"]);
    expect(booksStats(NOW).matched).toBeGreaterThanOrEqual(3);
  });

  it("has no current price for a game that has kicked off, and none for anyone after cleanup retires it", () => {
    const tip = new Date("2026-09-22T23:31:00Z");
    expect(pricesForGame("401857190", tip)).toEqual([]);
    expect(booksForGame("401857190", tip)).toEqual({ books: [], fetchedAt: null });
    const before = (getDb().prepare("SELECT COUNT(*) n FROM book_prices WHERE current = 1").get() as { n: number }).n;
    expect(before).toBeGreaterThan(0);
    const out = cleanupBooks(tip, 14);
    expect(out.retired).toBe(before);
    expect((getDb().prepare("SELECT COUNT(*) n FROM book_prices WHERE current = 1").get() as { n: number }).n).toBe(0);
  });

  it("deletes games past the retention window with their rows, and unmatched fixtures nobody posted for a day", () => {
    const old = event("superbet:superbet:old", "Washington Mystics", "Connecticut Sun", { superbet: "old" }, "2026-09-01T23:30:00Z");
    persistPrices([price("Superbet", old, { market: "moneyline", side: "home", decimal: 1.5, fetchedAt: "2026-09-01T12:00:00Z" })], "wnba", [{ ...GAME, id: "oldgame", startsAt: "2026-09-01T23:30:00Z" }], new Date("2026-09-01T12:00:00Z"));
    const ghost = event("superbet:superbet:ghost", "Novorizontino", "São Bernardo", { superbet: "ghost" }, "2026-09-25T22:30:00Z");
    persistPrices([price("Superbet", ghost, { market: "moneyline", side: "home", decimal: 2.1, fetchedAt: "2026-09-20T12:00:00Z" })], "soccer-bra", [], new Date("2026-09-20T12:00:00Z"));
    expect(listUnmatchedEvents(60, NOW).some((u) => u.key === ghost.key)).toBe(true);
    const out = cleanupBooks(new Date("2026-09-22T12:00:00Z"), 14);
    expect(out.events).toBe(2);
    expect(out.prices).toBe(2);
    expect(getDb().prepare("SELECT COUNT(*) n FROM book_events WHERE key IN (?, ?)").get(old.key, ghost.key)).toEqual({ n: 0 });
    expect(getDb().prepare("SELECT COUNT(*) n FROM book_prices WHERE eventKey IN (?, ?)").get(old.key, ghost.key)).toEqual({ n: 0 });
    // The live fixture, matched and still ahead of its retention date, is untouched.
    expect(getDb().prepare("SELECT COUNT(*) n FROM book_events WHERE key = 'superbet:superbet:1'").get()).toEqual({ n: 1 });
  });

  it("follows BR_BOOKS unless the admin switched a book by hand, and reads nobody when it is unset", () => {
    expect(activeAdapters({}).map((a) => a.id)).toEqual([]);
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

  it("answers a page view from memory until the books are read again", () => {
    resetGamePricesMemo();
    const ev = event("superbet:superbet:memo", "Washington Mystics", "Connecticut Sun", { superbet: "memo" }, "2026-09-26T23:30:00Z");
    const g = { ...GAME, id: "memo", startsAt: "2026-09-26T23:30:00Z" };
    persistPrices([price("Superbet", ev, { market: "moneyline", side: "home", decimal: 1.5 })], "wnba", [g], NOW);
    const sug = [{ id: "s1", kind: "single" as const, bandKey: "safe", title: "", background: "", legs: [{ selection: "Mystics", market: "ml", odds: "1.50", oddsDecimal: 1.5, explanation: "", evidence: "", fairProbability: 0.6, settlement: { type: "moneyline" as const, teamAbbreviation: "WSH", sourceBasis: "" } }], combinedDecimal: 1.5, combinedAmerican: "-200", impliedProbability: 0.67, modelledProbability: 0.6, edgePct: 0, riskNote: "", confidence: "medium" as const, evidenceScore: 50, evidenceNotes: [] }];
    const a = gamePrices("memo", sug, GAME, "wnba", NOW);
    const b = gamePrices("memo", sug, GAME, "wnba", new Date(NOW.getTime() + 10_000));
    expect(b).toBe(a);
    expect(a.tickets[0].bestSingleBook).toMatchObject({ book: "Superbet", decimal: 1.5 });
    // A new read changes the key: the next view computes again.
    const later = new Date(NOW.getTime() + 20_000);
    persistPrices([price("Superbet", ev, { market: "moneyline", side: "home", decimal: 1.55, fetchedAt: later.toISOString() })], "wnba", [g], later);
    expect(gamePrices("memo", sug, GAME, "wnba", later).tickets[0].bestSingleBook?.decimal).toBe(1.55);
  });
});

describe("runBooksJob", () => {
  const slate = async (day: string) => (day === "20260922" ? [GAME] : []);

  it("runs every adapter in isolation: one wall, one failure and one hang never stop the others", async () => {
    const ev = event("superbet:superbet:77", "Washington Mystics", "Connecticut Sun", { superbet: "77" });
    const started = event("superbet:superbet:78", "Washington Mystics", "Connecticut Sun", { superbet: "78" });
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
    expect(result.cleanup).toBeDefined();
    const ops = getDb().prepare("SELECT scope, level FROM ops_log WHERE scope LIKE 'job.books.%' ORDER BY scope").all() as { scope: string; level: string }[];
    expect(ops).toEqual(expect.arrayContaining([{ scope: "job.books.b-wall", level: "warn" }, { scope: "job.books.c-error", level: "error" }, { scope: "job.books.d-hang", level: "error" }]));
  }, 15_000);

  it("stops a slow adapter for real: the deadline aborts its requests, so it makes none after the job moves on", async () => {
    let calls = 0;
    const slow: BookAdapter = {
      id: "slow", book: "slow", platform: "slow", sports: ["wnba"], coverage: "", hosts: ["slow.example"],
      // The shape of a real adapter: every request honours the signal, as bookJson does.
      fetchBookOdds: async ({ signal }) => { for (let i = 0; i < 100; i += 1) { await sleep(50, signal); calls += 1; } return []; },
    };
    const t0 = Date.now();
    const res = await runBooksJob({ now: NOW, sports: ["wnba"], slate, adapters: [slow], env: { BOOKS_ADAPTER_TIMEOUT_MS: "5000" } });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4_900);
    expect(Date.now() - t0).toBeLessThan(7_000);
    expect(res.adapters[0].status).toBe("timeout");
    const at = calls;
    await new Promise((r) => setTimeout(r, 400));
    expect(calls).toBe(at);
  }, 15_000);

  it("skips the adapters that share a walled host and the ones past the tick's budget", async () => {
    let calledC = 0;
    const res = await runBooksJob({
      now: NOW, sports: ["wnba"], slate, env: { BOOKS_JOB_BUDGET_MS: "30000", BOOKS_ADAPTER_TIMEOUT_MS: "5000" },
      adapters: [
        fake("a-wall", new BookWallError("shared.example", 403), ["shared.example"]),
        { ...fake("b-sharer", [], ["shared.example"]), fetchBookOdds: () => { calledC += 1; return Promise.resolve([]); } },
        fake("c-other", [], ["other.example"]),
      ],
    });
    expect(res.adapters.map((a) => [a.id, a.status])).toEqual([["a-wall", "wall"], ["b-sharer", "wall"], ["c-other", "empty"]]);
    expect(calledC).toBe(0);
    expect(res.adapters[1].error).toMatch(/earlier this run/);
  });

  it("is an error only when something failed and nothing was written, and a skip when nothing is enabled", async () => {
    const bad = await runBooksJob({ now: NOW, sports: ["wnba"], slate, adapters: [fake("x", new Error("down"))] });
    expect(bad.status).toBe("error");
    const none = await runBooksJob({ now: NOW, sports: ["wnba"], slate, adapters: [] });
    expect(none.status).toBe("skipped");
    // The default env enables nobody: the same skip, without a single request.
    const unset = await runBooksJob({ now: NOW, sports: ["wnba"], slate, env: {} });
    expect(unset.status).toBe("skipped");
  });
});

/**
 * The cross-game path: a múltipla holds one leg per match, so the store has to answer for several
 * matches at once and the answer has to stay split by match — a flat list of two games' rows would
 * let one game's "vencedor da casa" answer for the other's.
 */
describe("a slate's prices", () => {
  const START = "2026-09-27T23:30:00Z";
  const NIGHT = new Date("2026-09-27T12:00:00Z");
  const A: Game = { ...GAME, id: "cross-a", startsAt: START, home: team("11", "NYL", "New York Liberty"), away: team("12", "ATL", "Atlanta Dream") };
  const B: Game = { ...GAME, id: "cross-b", startsAt: START, home: team("13", "SEA", "Seattle Storm"), away: team("14", "DAL", "Dallas Wings") };
  const evA = event("superbet:superbet:cross-a", "New York Liberty", "Atlanta Dream", { superbet: "14033560" }, START);
  const evB = event("superbet:superbet:cross-b", "Seattle Storm", "Dallas Wings", { superbet: "14033558" }, START);
  // No eventId on the row: Superbet's link builder reads the match's own id off the event, which is
  // exactly how a cross-game slip ends up naming two different matches.
  const ref = (outcome: string, uuid: string) => ({ marketId: "759", outcomeId: outcome, uuid });
  const ml = (ev: ReturnType<typeof event>, decimal: number, outcome: string, uuid: string) =>
    ({ ...price("Superbet", ev, { market: "moneyline" as const, side: "home" as const, decimal, ref: ref(outcome, uuid), fetchedAt: NIGHT.toISOString() }), platform: "superbet" });

  const leg = (gameId: string, abbr: string, decimal: number) => ({
    selection: abbr, market: "ml", odds: String(decimal), oddsDecimal: decimal, explanation: "", evidence: "", fairProbability: 1 / decimal,
    gameId, settlement: { type: "moneyline" as const, teamAbbreviation: abbr, sourceBasis: "" },
  });
  const ticket = {
    id: "x1", kind: "parlay" as const, bandKey: "value", title: "", background: "", combinedDecimal: 8.17, combinedAmerican: "+717",
    impliedProbability: 0.12, modelledProbability: 0.14, edgePct: 1, riskNote: "", confidence: "medium" as const, evidenceScore: 50, evidenceNotes: [],
    legs: [leg("cross-a", "NYL", 1.72), leg("cross-b", "SEA", 4.75)],
  };
  const teams = new Map([
    ["cross-a", { home: A.home, away: A.away }],
    ["cross-b", { home: B.home, away: B.away }],
  ]);

  beforeAll(() => {
    persistPrices([ml(evA, 1.72, "2182", "9ba38a44-eb49-51af-a13d-e09bddd8878d")], "wnba", [A, B], NIGHT);
    persistPrices([ml(evB, 4.75, "2182", "7c1d895e-1387-55aa-aa53-ec75230fe0c4")], "wnba", [A, B], NIGHT);
  });

  it("reads several matches in one go and keeps each match's rows to itself", () => {
    const byGame = pricesForGames(["cross-a", "cross-b", "no-such-game"], NIGHT);
    expect([...byGame.keys()].sort()).toEqual(["cross-a", "cross-b", "no-such-game"]);
    expect(byGame.get("cross-a")!.map((p) => p.decimal)).toEqual([1.72]);
    expect(byGame.get("cross-b")!.map((p) => p.decimal)).toEqual([4.75]);
    expect(byGame.get("no-such-game")).toEqual([]);
    // Each row still knows its own match, which is what the link builders name the event with.
    expect(byGame.get("cross-a")![0].event.externalIds.superbet).toBe("14033560");
    expect(pricesForGame("cross-a", NIGHT)).toEqual(byGame.get("cross-a"));
    expect(booksForGames(["cross-a", "cross-b"], NIGHT)).toEqual({ books: ["Superbet"], fetchedAt: NIGHT.toISOString() });
    expect(booksForGames([], NIGHT)).toEqual({ books: [], fetchedAt: null });
  });

  it("prices a cross-game ticket into one slip, and says the product is the price", () => {
    resetGamePricesMemo();
    const prices = slatePrices([ticket], teams, "wnba", NIGHT);
    expect(prices.books).toEqual(["Superbet"]);
    // No prop signals on a slate: that question belongs to a game page (see slatePrices).
    expect(prices.signals).toEqual([]);
    const t = prices.tickets[0];
    expect(t.crossGame).toBe(true);
    expect(t.bestSingleBook).toMatchObject({ book: "Superbet", decimal: Number((1.72 * 4.75).toFixed(2)) });
    const best = t.slip.best!;
    expect(best).toMatchObject({ book: "Superbet", covered: [0, 1], carried: [0, 1], full: true });
    // The number the reader is shown — and the one the real Superbet slip showed on 23/09/2026.
    expect(best.carriedDecimal).toBe(8.17);
    const bets = new URL(best.link.url).searchParams.getAll("bets[]");
    expect(bets.map((b) => b.split(",")[0])).toEqual(["14033560", "14033558"]);
  });

  it("leaves a leg whose match was not read unpriced instead of reading it off the other game", () => {
    resetGamePricesMemo();
    const t = slatePrices([ticket], new Map([["cross-a", teams.get("cross-a")!]]), "wnba", NIGHT).tickets[0];
    // The second leg names a game that is not in the slate's map: it is named on screen and covered
    // nowhere, and the link says one of two.
    expect(t.legs[1]).toBeNull();
    expect(t.slip.best).toMatchObject({ book: "Superbet", covered: [0], missing: [{ index: 1, reason: "market" }] });
    expect(t.bestSingleBook).toBeNull();
  });

  it("answers the next view from memory until the books are read again", () => {
    resetGamePricesMemo();
    const a = slatePrices([ticket], teams, "wnba", NIGHT);
    expect(slatePrices([ticket], teams, "wnba", new Date(NIGHT.getTime() + 10_000))).toBe(a);
    const later = new Date(NIGHT.getTime() + 20_000);
    persistPrices([{ ...ml(evA, 1.8, "2182", "9ba38a44-eb49-51af-a13d-e09bddd8878d"), fetchedAt: later.toISOString() }], "wnba", [A, B], later);
    expect(slatePrices([ticket], teams, "wnba", later).tickets[0].slip.best!.carriedDecimal).toBe(Number((1.8 * 4.75).toFixed(2)));
  });

  it("is empty when no leg names a match that was read", () => {
    expect(slatePrices([{ ...ticket, legs: [leg("nope", "NYL", 1.72)] }], teams, "wnba", NIGHT))
      .toEqual({ books: [], fetchedAt: null, tickets: [], signals: [] });
  });
});
