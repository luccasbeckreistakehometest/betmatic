import { describe, expect, it } from "vitest";
import { compareLeg, compareTicket, fairPrice, groupBySelection, propSignals } from "@/lib/sources/br-books/compare";
import type { BookPrice } from "@/lib/sources/br-books/types";
import { legQuery, statKeyOf, compareSuggestionsWith } from "@/lib/server/book-compare";
import { rowsFromBooks, consensusWithBooks } from "@/lib/props/consensus";
import type { BetSuggestion } from "@/lib/types";

const EVENT = { key: "e", home: "Washington Mystics", away: "Connecticut Sun", startsAt: "2026-09-22T23:30:00Z", externalIds: {}, sport: "basketball" as const };
const row = (book: string, p: Partial<BookPrice>): BookPrice => ({ book, platform: book === "Betfair Exchange" ? "betfair-exchange" : book.toLowerCase(), sport: "basketball", event: EVENT, market: "player_prop", fetchedAt: "2026-09-22T12:00:00Z", decimal: 1.9, ...p });
const prop = (book: string, player: string, stat: string, side: "over" | "under", line: number, decimal: number, extra: Partial<BookPrice> = {}) => row(book, { player, stat, side, line, decimal, kind: "total", ...extra });

// A real spread of prices on one WNBA line, as read on 22/09/2026, plus one book out of step.
const PRICES: BookPrice[] = [
  prop("Superbet", "Shakira Austin", "points", "over", 17.5, 1.92), prop("Superbet", "Shakira Austin", "points", "under", 17.5, 1.78),
  prop("EstrelaBet", "Shakira Austin", "points", "over", 17.5, 1.9091), prop("EstrelaBet", "Shakira Austin", "points", "under", 17.5, 1.8334),
  prop("Aposta Ganha", "Shakira Austin", "points", "over", 17.5, 1.87), prop("Aposta Ganha", "Shakira Austin", "points", "under", 17.5, 1.87),
  prop("Vaidebet", "Shakira Austin", "points", "over", 17.5, 2.1), prop("Vaidebet", "Shakira Austin", "points", "under", 17.5, 1.7),
  // The same stat at a friendlier line elsewhere.
  prop("LotoGreen", "Shakira Austin", "points", "over", 16.5, 1.9),
  // Game lines with an exchange reference.
  row("Superbet", { market: "moneyline", side: "away", decimal: 7.8 }), row("KTO", { market: "moneyline", side: "away", decimal: 7.5 }), row("Betnacional", { market: "moneyline", side: "away", decimal: 8 }),
  row("Superbet", { market: "moneyline", side: "home", decimal: 1.07 }), row("KTO", { market: "moneyline", side: "home", decimal: 1.1 }), row("Betnacional", { market: "moneyline", side: "home", decimal: 1.056 }),
  row("Betfair Exchange", { market: "moneyline", side: "away", decimal: 9.6, lay: 11 }),
];

describe("compareLeg", () => {
  it("finds the best and worst book at the exact line and how far apart they are", () => {
    const c = compareLeg(PRICES, { market: "player_prop", player: "Austin, Shakira", stat: "points", side: "over", line: 17.5 });
    expect(c.quotes.map((q) => q.book)).toEqual(["Vaidebet", "Superbet", "EstrelaBet", "Aposta Ganha"]);
    expect(c.best).toMatchObject({ book: "Vaidebet", decimal: 2.1 });
    expect(c.worst).toMatchObject({ book: "Aposta Ganha", decimal: 1.87 });
    expect(c.bestVsWorstPct).toBe(12.3);
    expect(c.medianDecimal).toBe(1.915);
  });

  it("flags the book that sits ≥ 7% off the median of the other FEEDS on a player line", () => {
    const c = compareLeg(PRICES, { market: "player_prop", player: "Shakira Austin", stat: "points", side: "over", line: 17.5 });
    expect(c.dispersion).toHaveLength(1);
    // Three other books on three platforms here (the fixture gives each book its own platform).
    expect(c.dispersion[0]).toMatchObject({ book: "Vaidebet", decimal: 2.1, others: 3, otherBooks: 3 });
    expect(c.dispersion[0].othersMedian).toBe(1.909);
    expect(c.dispersion[0].pct).toBe(10);
    // The threshold is configurable: at 15% nothing is out of step.
    expect(compareLeg(PRICES, c.query, { dispersionPct: 15 }).dispersion).toHaveLength(0);
  });

  it("counts one feed's tenants once: four identical Altenar prices are one 'other', not four", () => {
    const rows = [
      prop("Superbet", "Kiki Iriafen", "points", "over", 9.5, 2.7),
      prop("EstrelaBet", "Kiki Iriafen", "points", "over", 9.5, 2.4), prop("LotoGreen", "Kiki Iriafen", "points", "over", 9.5, 2.4),
      prop("Aposta Ganha", "Kiki Iriafen", "points", "over", 9.5, 2.4), prop("Vaidebet", "Kiki Iriafen", "points", "over", 9.5, 2.4),
    ].map((r) => ({ ...r, platform: r.book === "Superbet" ? "superbet" : "altenar" }));
    const c = compareLeg(rows, { market: "player_prop", player: "Kiki Iriafen", stat: "points", side: "over", line: 9.5 });
    expect(c.dispersion[0]).toMatchObject({ book: "Superbet", pct: 12.5, others: 1, otherBooks: 4, othersMedian: 2.4 });
    // And an Altenar tenant is measured against Superbet alone, not against its own clones.
    expect(c.dispersion.find((d) => d.book === "EstrelaBet")).toMatchObject({ others: 1, otherBooks: 1, othersMedian: 2.7, pct: -11.11 });
  });

  it("flags the same stat at a friendlier line at another book", () => {
    const c = compareLeg(PRICES, { market: "player_prop", player: "Shakira Austin", stat: "points", side: "over", line: 17.5 });
    expect(c.lineAlternatives).toEqual([{ book: "LotoGreen", line: 16.5, decimal: 1.9, better: true, url: undefined }]);
    // For an under the friendlier line is the higher one.
    const under = compareLeg([...PRICES, prop("KTO", "Shakira Austin", "points", "under", 18.5, 1.8)], { market: "player_prop", player: "Shakira Austin", stat: "points", side: "under", line: 17.5 });
    expect(under.lineAlternatives[0]).toMatchObject({ book: "KTO", line: 18.5, better: true });
    // A friendlier line at a much worse price is listed but not called better.
    const worse = compareLeg([...PRICES, prop("KTO", "Shakira Austin", "points", "over", 16.5, 1.5)], c.query);
    expect(worse.lineAlternatives.find((a) => a.book === "KTO")).toMatchObject({ better: false });
  });

  it("trusts the exchange only with a lay within 10% of the back; a lone back order or a wide gap falls back to no-vig", () => {
    const books = [row("A", { market: "moneyline", side: "away", decimal: 1.21 }), row("A", { market: "moneyline", side: "home", decimal: 4.3 })];
    const q = { market: "moneyline" as const, side: "away" as const };
    // Back-only 1.01 dust on the exchange: not a market. Fair comes from A's own two sides.
    expect(fairPrice([...books, row("Betfair Exchange", { market: "moneyline", side: "away", decimal: 1.01 })], q)).toMatchObject({ source: "novig" });
    // Back 1.2 / lay 1.5 is a 25% gap: nobody is trading there.
    expect(fairPrice([...books, row("Betfair Exchange", { market: "moneyline", side: "away", decimal: 1.2, lay: 1.5 })], q)).toMatchObject({ source: "novig" });
    // Back 1.2 / lay 1.24 is a market: midpoint 1.22. So is 9.6 / 11 on an underdog (1.3 points of chance apart).
    expect(fairPrice([...books, row("Betfair Exchange", { market: "moneyline", side: "away", decimal: 1.2, lay: 1.24 })], q)).toMatchObject({ source: "exchange", decimal: 1.22 });
    expect(fairPrice([...books, row("Betfair Exchange", { market: "moneyline", side: "away", decimal: 9.6, lay: 11 })], q)).toMatchObject({ source: "exchange", decimal: 10.3 });
    // A lay below the back is a crossed book, not a market either.
    expect(fairPrice([...books, row("Betfair Exchange", { market: "moneyline", side: "away", decimal: 1.3, lay: 1.2 })], q)).toMatchObject({ source: "novig" });
    const edge = compareLeg([...books, row("Betfair Exchange", { market: "moneyline", side: "away", decimal: 1.01 })], q);
    expect(edge.fair?.source).toBe("novig");
    expect(edge.edgeVsFairPct[0].pct).toBeLessThan(0);
  });

  it("uses the exchange midpoint as the fair price and no-vig pairs when there is none", () => {
    const ml = compareLeg(PRICES, { market: "moneyline", side: "away" });
    expect(ml.exchange).toMatchObject({ book: "Betfair Exchange", decimal: 9.6, lay: 11 });
    expect(ml.quotes.map((q) => q.book)).toEqual(["Betnacional", "Superbet", "KTO"]);
    expect(ml.fair).toMatchObject({ source: "exchange", decimal: 10.3 });
    expect(ml.edgeVsFairPct.find((e) => e.book === "Betnacional")?.pct).toBe(-22.33);
    const pts = fairPrice(PRICES, { market: "player_prop", player: "Shakira Austin", stat: "points", side: "over", line: 17.5 });
    expect(pts?.source).toBe("novig");
    expect(pts?.books).toBe(4);
    expect(pts!.probability).toBeGreaterThan(0.44);
    expect(pts!.probability).toBeLessThan(0.52);
  });

  it("treats a book's over/under pair and its N+ rung at the same line as one selection, keeping the better price", () => {
    const rows = [
      prop("Superbet", "Kiki Iriafen", "points", "over", 17.5, 2.2, { kind: "milestone" }),
      prop("Superbet", "Kiki Iriafen", "points", "over", 17.5, 2.05, { kind: "total" }),
      prop("EstrelaBet", "Kiki Iriafen", "points", "over", 17.5, 2.1, { kind: "total" }),
    ];
    const c = compareLeg(rows, { market: "player_prop", player: "Kiki Iriafen", stat: "points", side: "over", line: 17.5 });
    expect(c.quotes.map((q) => [q.book, q.decimal])).toEqual([["Superbet", 2.2], ["EstrelaBet", 2.1]]);
    expect(c.quotes).toHaveLength(2);
  });

  it("keeps only the newest row per book and ignores lines nobody posts", () => {
    const stale = prop("Superbet", "Shakira Austin", "points", "over", 17.5, 1.5, { fetchedAt: "2026-09-21T12:00:00Z" });
    const c = compareLeg([...PRICES, stale], { market: "player_prop", player: "Shakira Austin", stat: "points", side: "over", line: 17.5 });
    expect(c.quotes.find((q) => q.book === "Superbet")?.decimal).toBe(1.92);
    const none = compareLeg(PRICES, { market: "player_prop", player: "Caitlin Clark", stat: "points", side: "over", line: 20.5 });
    expect(none.best).toBeNull();
    expect(none.bestVsWorstPct).toBeNull();
  });
});

describe("compareTicket", () => {
  const legs = [
    { query: { market: "player_prop" as const, player: "Shakira Austin", stat: "points", side: "over" as const, line: 17.5 }, decimal: 1.9 },
    { query: { market: "moneyline" as const, side: "home" as const }, decimal: 1.07 },
  ];

  it("totals the whole ticket at the one book that prices every leg, and the ceiling of each leg's best", () => {
    const t = compareTicket(PRICES, legs);
    // Only Superbet prices both legs; Vaidebet has the prop but no moneyline.
    expect(t.bestSingleBook).toEqual({ book: "Superbet", decimal: 2.05, priced: 2, of: 2 });
    expect(t.theoreticalBest).toBe(2.31); // 2.1 × 1.1
    expect(t.referenceDecimal).toBe(2.03);
    expect(t.bestSingleVsReferencePct).toBe(0.99);
    expect(t.theoreticalVsReferencePct).toBe(13.79);
    expect(t.perBook[0]).toMatchObject({ book: "Superbet", priced: 2 });
    expect(t.books).toContain("Vaidebet");
  });

  it("has no single-book total when no book prices every leg", () => {
    const t = compareTicket(PRICES.filter((p) => p.book !== "Superbet"), legs);
    expect(t.bestSingleBook).toBeNull();
    expect(t.theoreticalBest).toBe(2.31);
  });
});

describe("propSignals", () => {
  it("groups the game's rows by selection once and answers each query from its own group", () => {
    const groups = groupBySelection(PRICES);
    expect(groups.get("prop|shakira austin|points")).toHaveLength(9);
    expect(groups.get("moneyline")).toHaveLength(7);
    // The grouped path and the whole-game path agree on every leg.
    const q = { market: "player_prop" as const, player: "Shakira Austin", stat: "points", side: "over" as const, line: 17.5 };
    const direct = compareLeg(PRICES, q);
    const grouped = compareLeg(groups.get("prop|shakira austin|points")!, q);
    expect(grouped).toEqual(direct);
    expect(direct.best?.book).toBe("Vaidebet");
  });

  it("ranks the player lines where a book is out of step", () => {
    const s = propSignals(PRICES);
    expect(s[0]).toMatchObject({ player: "Shakira Austin", stat: "points", side: "over", line: 17.5 });
    expect(s[0].comparison.dispersion[0].book).toBe("Vaidebet");
    expect(s.every((x) => x.comparison.quotes.length >= 2)).toBe(true);
  });
});

describe("leg → query", () => {
  const game = { home: { abbreviation: "WSH", displayName: "Washington Mystics" }, away: { abbreviation: "CONN", displayName: "Connecticut Sun" } };

  it("reads the settlement descriptor in the model's spelling of the stat", () => {
    expect(statKeyOf("points", "wnba")).toBe("points");
    expect(statKeyOf("Points", "wnba")).toBe("points");
    expect(statKeyOf("PTS", "wnba")).toBe("points");
    expect(statKeyOf("pontos", "wnba")).toBe("points");
    expect(statKeyOf("points + rebounds + assists", "wnba")).toBe("pra");
    expect(statKeyOf("Pontos + Rebotes + Assistências", "wnba")).toBe("pra");
    expect(statKeyOf("3-pointers made", "wnba")).toBe("threes");
    expect(statKeyOf("Shots on Target", "soccer-bra")).toBe("shots_on_target");
    expect(statKeyOf("dunks", "wnba")).toBeNull();
  });

  it("names every market type the ledger grades, and nothing it cannot", () => {
    expect(legQuery({ settlement: { type: "player_prop", player: "Shakira Austin", stat: "points", line: 17.5, side: "over", sourceBasis: "" } }, game, "wnba")).toEqual({ market: "player_prop", player: "Shakira Austin", stat: "points", line: 17.5, side: "over" });
    expect(legQuery({ settlement: { type: "moneyline", teamAbbreviation: "CONN", sourceBasis: "" } }, game, "wnba")).toEqual({ market: "moneyline", side: "away" });
    expect(legQuery({ settlement: { type: "spread", teamAbbreviation: "WSH", line: -7.5, sourceBasis: "" } }, game, "wnba")).toEqual({ market: "spread", side: "home", line: -7.5 });
    expect(legQuery({ settlement: { type: "total", line: 150.5, side: "under", sourceBasis: "" } }, game, "wnba")).toEqual({ market: "total", side: "under", line: 150.5 });
    expect(legQuery({ settlement: { type: "total", teamAbbreviation: "WSH", line: 82.5, side: "over", sourceBasis: "" } }, game, "wnba")).toBeNull();
    expect(legQuery({ settlement: { type: "other", sourceBasis: "" } }, game, "wnba")).toBeNull();
    expect(legQuery({}, game, "wnba")).toBeNull();
  });

  it("puts each verdict under its leg and withholds the totals when a leg cannot be named", () => {
    const base = { market: "player prop", odds: "1.90", oddsDecimal: 1.9, explanation: "", evidence: "", fairProbability: 0.5 };
    const s = (id: string, legs: BetSuggestion["legs"]): BetSuggestion => ({ id, kind: "parlay", bandKey: "value", title: id, background: "", legs, combinedDecimal: 2, combinedAmerican: "+100", impliedProbability: 0.5, modelledProbability: 0.5, edgePct: 0, riskNote: "", confidence: "medium", evidenceScore: 50, evidenceNotes: [] });
    const out = compareSuggestionsWith(PRICES, [
      s("a", [{ ...base, selection: "Austin o17.5", settlement: { type: "player_prop", player: "Shakira Austin", stat: "points", line: 17.5, side: "over", sourceBasis: "" } }, { ...base, selection: "?", settlement: { type: "other", sourceBasis: "" } }]),
      s("b", [{ ...base, selection: "Mystics", oddsDecimal: 1.07, settlement: { type: "moneyline", teamAbbreviation: "WSH", sourceBasis: "" } }]),
    ], game, "wnba");
    expect(out.map((t) => t.suggestionId)).toEqual(["a", "b"]);
    expect(out[0].legs[0]?.best?.book).toBe("Vaidebet");
    expect(out[0].legs[1]).toBeNull();
    expect(out[0].bestSingleBook).toBeNull();
    expect(out[0].theoreticalBest).toBeNull();
    expect(out[1].bestSingleBook).toMatchObject({ book: "KTO", decimal: 1.1 });
  });
});

describe("books in the model's consensus", () => {
  it("turns book rows into the same sourced props the free feed posts, and names the best book", () => {
    const rows = rowsFromBooks(PRICES, "wnba", { home: "Washington Mystics", away: "Connecticut Sun" });
    expect(rows.find((r) => r.book === "Vaidebet" && r.player === "Shakira Austin")).toMatchObject({ market: "Points", marketKey: "points", side: "over", line: 17.5, odds: "2.10", source: "Vaidebet", priced: true });
    expect(rows.filter((r) => r.market === "moneyline").map((r) => r.player)).toContain("Connecticut Sun");
    // The exchange is the reference, never a place to bet.
    expect(rows.some((r) => r.book === "Betfair Exchange")).toBe(false);
    const consensus = consensusWithBooks([{ player: "Shakira Austin", market: "Points", marketKey: "points", line: 17.5, side: "over", odds: "1.85", book: "DraftKings", priced: true }], [], { home: "Washington Mystics", away: "Connecticut Sun" }, PRICES, "wnba");
    const austin = consensus.find((c) => c.player === "Shakira Austin" && c.side === "over")!;
    expect(austin.sources).toEqual(expect.arrayContaining(["DraftKings", "Superbet", "Vaidebet", "LotoGreen"]));
    expect(austin.best).toMatchObject({ book: "Vaidebet", decimal: 2.1 });
    expect(austin.lineDisagreement).toBe(true);
    expect(austin.consensusLine).toBe(17.5);
  });
});
