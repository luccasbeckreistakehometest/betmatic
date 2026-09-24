import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-live-price-read");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
process.env.PROOF_MIN_DECIDED = "1";
fs.rmSync(DIR, { recursive: true, force: true });

import type { BookPrice } from "@/lib/sources/br-books/types";
import type { BetLeg, BetSuggestion, Game, LedgerEntry, PropRow } from "@/lib/types";

const { applyLivePrices, liveBoard, liveBoardSize, liveQuoteFor } = await import("@/lib/props/live-prices");
const { anchoredOdds } = await import("@/lib/bets/enrich");
const { describeProps, inPlayNote, IN_PLAY_NOTE } = await import("@/lib/bets/builder");
const { liveTicketsPriced, recordLiveLegPrices } = await import("@/lib/server/live-read");
const { proofStats } = await import("@/lib/ledger/proof");
const { getDb } = await import("@/lib/server/db");

/**
 * The promise the live scope has always made — it never quotes a price nobody could have taken —
 * held to with a live price on the board. What changes is not the promise, it is that the answer
 * can now be yes: a line a book is quoting in play is priced at that number, a line no book is
 * quoting stays a pre-game reference and says so, and the two never become one population.
 */
const AT = "2026-09-23T00:40:00.000Z";
const team = (id: string, abbr: string, name: string): Game["home"] => ({ id, abbreviation: abbr, name: name.split(" ").pop()!, displayName: name });
const GAME: Game = { id: "401857190", sportKey: "wnba", startsAt: "2026-09-22T23:30:00Z", status: "live", statusDetail: "", home: team("1", "WSH", "Washington Mystics"), away: team("2", "CONN", "Connecticut Sun") };
const EV = { key: "superbet:superbet:1", home: "Washington Mystics", away: "Connecticut Sun", startsAt: GAME.startsAt, externalIds: {}, sport: "basketball" as const };
const book = (p: Partial<BookPrice>): BookPrice => ({ book: "Superbet", platform: "superbet", sport: "basketball", event: EV, market: "player_prop", decimal: 1.9, fetchedAt: AT, inPlay: true, ...p });

const PROP: PropRow = {
  player: "Paige Bueckers", market: "Pontos + Rebotes + Assistências", marketKey: "pra", line: 24.5, side: "over",
  odds: "1.85", decimal: 1.85, book: "ESPN BET", priced: true, athleteId: "4433403", noVigFair: 0.52, openDecimal: 1.8,
  live: { current: 18, remaining: 7, minutesLeft: 14 },
};

describe("the board reduces the books' in-play rows to the best takeable price", () => {
  const board = liveBoard([
    book({ player: "Paige Bueckers", stat: "pra", line: 24.5, side: "over", decimal: 2.1 }),
    book({ book: "KTO", platform: "kambi", player: "Paige Bueckers", stat: "pra", line: 24.5, side: "over", decimal: 2.35 }),
    book({ market: "moneyline", side: "home", decimal: 1.44 }),
    book({ market: "total", side: "over", line: 158.5, decimal: 1.92 }),
  ]);

  it("takes the best price across books, and names the book that pays it", () => {
    expect(board.props.get("paige bueckers|pra|over|24.5")).toEqual({ book: "KTO", decimal: 2.35, fetchedAt: AT });
    expect(board.books).toEqual(["KTO", "Superbet"]);
    expect(liveBoardSize(board)).toBe(3);
  });

  it("refuses a pre-game row, the exchange and an N+ rung, which are three different bets", () => {
    const wrong = liveBoard([
      book({ inPlay: false, player: "Paige Bueckers", stat: "pra", line: 24.5, side: "over", decimal: 9 }),
      book({ platform: "betfair-exchange", book: "Betfair Exchange", market: "moneyline", side: "home", decimal: 9 }),
      book({ kind: "milestone", player: "Paige Bueckers", stat: "points", line: 24.5, side: "over", decimal: 9 }),
    ]);
    expect(liveBoardSize(wrong)).toBe(0);
  });

  it("prices a settled leg only when a book posts that exact line in play", () => {
    expect(liveQuoteFor({ type: "player_prop", player: "Paige Bueckers", stat: "pra", line: 24.5, side: "over", sourceBasis: "" }, "WSH", board)?.decimal).toBe(2.35);
    // A neighbouring line is a different bet: no price, not the nearest one.
    expect(liveQuoteFor({ type: "player_prop", player: "Paige Bueckers", stat: "pra", line: 25.5, side: "over", sourceBasis: "" }, "WSH", board)).toBeNull();
    expect(liveQuoteFor({ type: "moneyline", teamAbbreviation: "WSH", sourceBasis: "" }, "WSH", board)?.decimal).toBe(1.44);
    expect(liveQuoteFor({ type: "moneyline", teamAbbreviation: "CONN", sourceBasis: "" }, "WSH", board)).toBeNull();
  });
});

describe("the read's own prices", () => {
  const board = liveBoard([book({ player: "Paige Bueckers", stat: "pra", line: 24.5, side: "over", decimal: 2.35 })]);
  const other: PropRow = { ...PROP, player: "Sonia Citron", athleteId: "5105607", line: 14.5, marketKey: "points", market: "Pontos", odds: "1.95", decimal: 1.95 };

  it("replaces the pre-game reference with the live price, and drops the fair that went with it", () => {
    const out = applyLivePrices([PROP, other], board);
    expect(out.priced).toBe(1);
    expect(out.props[0]).toMatchObject({ odds: "2.35", decimal: 2.35, book: "Superbet", livePrice: { book: "Superbet", decimal: 2.35 } });
    // The pre-game no-vig fair was computed from the pre-game pair, which is not this pair.
    expect(out.props[0].noVigFair).toBeNull();
    // The line nobody is quoting in play is returned exactly as it came in.
    expect(out.props[1]).toEqual(other);
  });

  it("anchors the ticket's leg to the live price, over the prop feed and over the model's text", () => {
    const key = { settlementType: "player_prop", settlementPlayer: "Paige Bueckers", settlementStat: "pra", settlementLine: 24.5, settlementSide: "over", settlementTeam: null, odds: "3.40" };
    const props = applyLivePrices([PROP], board).props;
    expect(anchoredOdds(key, { props, sportKey: "wnba", game: GAME, liveBoard: board })).toBe("2.35");
    // Without a board it is the feed's pre-game number, exactly as before this existed.
    expect(anchoredOdds(key, { props: [PROP], sportKey: "wnba", game: GAME })).toBe("1.85");
  });

  it("tells the model which rows are takeable and which are a memory, per row", () => {
    const text = describeProps(applyLivePrices([PROP, other], board).props, new Date(AT));
    expect(text).toContain("[LIVE PRICE]");
    expect(text).toContain("[pre-game reference]");
    expect(text.split("\n")[0]).toContain("1 of the 2 lines below carry a LIVE PRICE");
  });

  it("keeps the old note word for word when no book is quoting in play", () => {
    expect(inPlayNote([PROP])).toBe(IN_PLAY_NOTE);
    expect(describeProps([PROP])).toContain("no live odds source is configured");
  });
});

describe("the ledger knows which live tickets could have been taken", () => {
  const board = liveBoard([
    book({ player: "Paige Bueckers", stat: "pra", line: 24.5, side: "over", decimal: 2.35 }),
    book({ market: "moneyline", side: "home", decimal: 1.44 }),
  ]);
  // The ledger id is built from the band and the leg selections, so each ticket here needs its own.
  const leg = (decimal: number, s: BetLeg["settlement"], selection = `sel ${decimal}`): BetLeg => ({ selection, market: "player_prop", odds: String(decimal), oddsDecimal: decimal, explanation: "", evidence: "", fairProbability: 0.5, athleteId: "4433403", settlement: s });
  const pra = (d: number) => leg(d, { type: "player_prop", player: "Paige Bueckers", stat: "pra", line: 24.5, side: "over", sourceBasis: "" });
  const ml = (d: number) => leg(d, { type: "moneyline", teamAbbreviation: "WSH", sourceBasis: "" });
  const ticket = (id: string, legs: BetLeg[]): BetSuggestion => ({ id, kind: legs.length > 1 ? "parlay" : "single", bandKey: "mid", title: "", background: "", legs, combinedDecimal: legs.reduce((a, l) => a * l.oddsDecimal, 1), combinedAmerican: "", impliedProbability: 0.4, modelledProbability: 0.4, edgePct: 0, riskNote: "", confidence: "medium", evidenceScore: 50, evidenceNotes: [] });

  const taken = ticket("taken", [pra(2.35)]);
  const mixed = ticket("mixed", [pra(2.35), leg(1.9, { type: "player_prop", player: "Sonia Citron", stat: "points", line: 14.5, side: "over", sourceBasis: "" })]);
  const invented = ticket("invented", [pra(3.4)]);
  const both = ticket("both", [pra(2.35), ml(1.44)]);

  it("counts a ticket as taken only when every one of its legs was struck at the live price", () => {
    const priced = liveTicketsPriced(GAME, [taken, mixed, invented, both], board);
    expect([...priced].sort()).toEqual(["both", "taken"]);
    // A leg the model priced from its own text is not takeable because a book also lists the line.
    expect(priced.has("invented")).toBe(false);
    expect(liveTicketsPriced(GAME, [taken], null)).toEqual(new Set());
  });

  it("writes live_book/live_taken for a takeable leg and leaves the old marking on the rest", () => {
    expect(recordLiveLegPrices(GAME, [taken, invented], { minute: 28, period: 3 }, board)).toBe(2);
    const rows = getDb().prepare("SELECT ledgerId, basis, status FROM leg_prices ORDER BY ledgerId").all() as { ledgerId: string; basis: string; status: string }[];
    expect(rows.map((r) => [r.basis, r.status])).toEqual([["live_book", "live_taken"], ["live", "no_live_price"]]);
    // Neither marking is pending, so the close job — which prices against the PRE-GAME close — never
    // sees an in-play bet. There is no closing line for a bet struck in the third quarter.
    expect(getDb().prepare("SELECT COUNT(*) n FROM leg_prices WHERE status='pending'").get()).toEqual({ n: 0 });
  });

  it("never rewrites a row that is already there, so nothing old turns collectable", () => {
    expect(recordLiveLegPrices(GAME, [invented], { minute: 28, period: 3 }, board)).toBe(0);
    const again = getDb().prepare("SELECT basis, status FROM leg_prices WHERE ledgerId LIKE '%sel 3.4%'").all() as { basis: string; status: string }[];
    expect(again).toEqual([{ basis: "live", status: "no_live_price" }]);
  });
});

describe("/prova keeps the two live populations apart", () => {
  const entry = (id: string, outcome: LedgerEntry["outcome"], over: Partial<LedgerEntry>): LedgerEntry => ({
    id, gameId: "401857190", sportKey: "wnba", matchup: "CONN @ WSH", createdAt: AT, settledAt: AT, startsAt: GAME.startsAt,
    bandKey: "mid", kind: "single", title: "t", combinedDecimal: 2.35, modelledProbability: 0.45, legs: [], outcome, ...over,
  });
  const rows = [
    entry("pre-won", "won", { combinedDecimal: 1.8 }),
    entry("pre-lost", "lost", { combinedDecimal: 1.8 }),
    entry("live-ref-won", "won", { scope: "live" }),
    entry("live-ref-won-2", "won", { scope: "live" }),
    entry("live-live-won", "won", { scope: "live", priceBasis: "live_book" }),
    entry("live-live-lost", "lost", { scope: "live", priceBasis: "live_book" }),
  ];
  const s = proofStats(rows);

  it("gives the in-play-priced reads their own row, with a return", () => {
    const priced = s.byScope.find((r) => r.key === "live_priced")!;
    expect(priced).toMatchObject({ settled: 2, won: 1 });
    expect(priced.roi).toBeCloseTo((2.35 - 1 - 1) / 2, 6);
  });

  it("still gives the reference-priced reads counts and no return at all", () => {
    expect(s.byScope.find((r) => r.key === "live")).toEqual({ key: "live", settled: 2, won: 2 });
  });

  it("leaves the headline as the pre-game record, unchanged by either live row", () => {
    expect(s.unitsStaked).toBe(2);
    expect(s.roi).toBeCloseTo((1.8 - 1 - 1) / 2, 6);
    expect(s.byDay[0]).toMatchObject({ settled: 2, unitsStaked: 2 });
  });

  it("treats an entry written before the in-play round as what it was", () => {
    const old = proofStats([entry("legacy", "won", { scope: "live" })]);
    expect(old.byScope.map((r) => r.key)).toEqual(["live"]);
    expect(old.unitsStaked).toBe(0);
  });
});

beforeAll(() => { getDb(); });
