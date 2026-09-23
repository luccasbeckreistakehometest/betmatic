import { describe, expect, it } from "vitest";
import { NEAR_MAX_LINE_MOVE, NEAR_MAX_PROBABILITY_GAP, ticketSlip, type SlipLeg } from "@/lib/sources/br-books/coverage";
import type { LegQuery } from "@/lib/sources/br-books/compare";
import type { BookEvent, BookPrice } from "@/lib/sources/br-books/types";

/**
 * The best-effort ticket link: how much of a ticket each book can carry, what the link it builds
 * actually contains, and when a rung one step away is close enough to be offered as a different
 * bet. The rows are synthetic on purpose — every price here exists to move one rule.
 */
const AT = "2026-09-23T12:00:00.000Z";
const START = "2026-09-23T23:30:00.000Z";

const event = (platform: string, id: string): BookEvent => ({
  key: `${platform}:${id}`, home: "Aurora Aces", away: "Boreal Birds", startsAt: START, externalIds: { [platform]: id }, sport: "basketball", league: "WNBA",
});

const SB = event("superbet", "5001");
const SPB = event("sportingbet", "6001");
const BN = event("betnacional", "7001");
const AL = event("altenar", "8001");

let seq = 0;
/** One row, with ids shaped like the platform's own so the real link builders accept it. */
function row(book: string, platform: string, ev: BookEvent, p: Partial<BookPrice>): BookPrice {
  seq += 1;
  const ref = platform === "superbet"
    ? { eventId: ev.externalIds.superbet, marketId: "759", outcomeId: `2${seq}`, uuid: `e2e0aaaa-0000-5000-8000-00000000${String(seq).padStart(4, "0")}` }
    : platform === "sportingbet"
      ? { eventId: ev.externalIds.sportingbet, marketId: `156${seq}`, outcomeId: `230${seq}` }
      : platform === "betnacional"
        ? { eventId: ev.externalIds.betnacional, marketId: `999${seq}` }
        : { eventId: ev.externalIds.altenar, marketId: `174${seq}`, outcomeId: `453${seq}` };
  return { book, platform, sport: "basketball", event: ev, market: "moneyline", decimal: 1.9, fetchedAt: AT, ref, ...p };
}

const prop = (player: string, stat: string, line: number, side: "over" | "under", decimal: number) =>
  ({ market: "player_prop" as const, player, stat, line, side, decimal, kind: "total" as const });

const q = {
  ml: { market: "moneyline", side: "home" } as LegQuery,
  lima: { market: "player_prop", player: "Ana Lima", stat: "points", line: 17.5, side: "over" } as LegQuery,
  souza: { market: "player_prop", player: "Bia Souza", stat: "rebounds", line: 6.5, side: "over" } as LegQuery,
};
const legs = (...items: [LegQuery | null, number | null][]): SlipLeg[] => items.map(([query, decimal]) => ({ query, decimal }));

describe("full coverage", () => {
  const prices = [
    row("Superbet", "superbet", SB, { side: "home", decimal: 1.62 }),
    row("Superbet", "superbet", SB, prop("Ana Lima", "points", 17.5, "over", 1.95)),
    row("Superbet", "superbet", SB, prop("Bia Souza", "rebounds", 6.5, "over", 1.88)),
  ];

  it("carries every leg into one slip and pays the product of the legs it carries", () => {
    const slip = ticketSlip(prices, legs([q.ml, 1.6], [q.lima, 1.9], [q.souza, 1.85]));
    expect(slip.kind).toBe("full");
    expect(slip.legs).toBe(3);
    expect(slip.best).toMatchObject({ book: "Superbet", covered: [0, 1, 2], missing: [], full: true, decimal: Number((1.62 * 1.95 * 1.88).toFixed(2)) });
    expect(slip.best!.link).toMatchObject({ kind: "betslip", selections: 3, verified: true });
    expect(new URL(slip.best!.link.url).searchParams.getAll("bets[]")).toHaveLength(3);
    // Nothing is missing, so nothing is offered as close: a near line only ever stands in for a gap.
    expect(slip.nearLines).toEqual([]);
  });
});

describe("partial coverage", () => {
  // Superbet has three of the four legs; Sportingbet has two of them and pays more on both.
  const prices = [
    row("Superbet", "superbet", SB, { side: "home", decimal: 1.62 }),
    row("Superbet", "superbet", SB, prop("Ana Lima", "points", 17.5, "over", 1.95)),
    row("Superbet", "superbet", SB, prop("Bia Souza", "rebounds", 6.5, "over", 1.88)),
    row("Sportingbet", "sportingbet", SPB, { side: "home", decimal: 1.75 }),
    row("Sportingbet", "sportingbet", SPB, prop("Ana Lima", "points", 17.5, "over", 2.2)),
  ];
  const four = legs([q.ml, 1.6], [q.lima, 1.9], [q.souza, 1.85], [{ market: "player_prop", player: "Kiki Iriafen", stat: "points", line: 16.5, side: "under" } as LegQuery, 1.8]);

  it("builds the slip with the legs the book has, names the ones it does not and says why", () => {
    const slip = ticketSlip(prices, four);
    expect(slip.kind).toBe("partial");
    expect(slip.best).toMatchObject({ book: "Superbet", covered: [0, 1, 2], full: false });
    // Nobody posts Kiki Iriafen at all: the reason is the market, not the line.
    expect(slip.best!.missing).toEqual([{ index: 3, reason: "market" }]);
    // The price is the three legs the link carries, never the ticket's own four.
    expect(slip.best!.decimal).toBe(Number((1.62 * 1.95 * 1.88).toFixed(2)));
    expect(new URL(slip.best!.link.url).searchParams.getAll("bets[]")).toHaveLength(3);
    // More of the ticket beats a better price on less of it: Sportingbet pays more per leg and is second.
    expect(slip.others.map((o) => [o.book, o.covered.length])).toEqual([["Sportingbet", 2]]);
  });

  it("tells a line the book skips apart from a market it does not price", () => {
    // Sportingbet posts Bia Souza at 7.5, not at the ticket's 6.5.
    const withOther = [...prices, row("Sportingbet", "sportingbet", SPB, prop("Bia Souza", "rebounds", 7.5, "over", 2.4))];
    const slip = ticketSlip(withOther, four);
    const sportingbet = slip.others.find((o) => o.book === "Sportingbet")!;
    expect(sportingbet.missing).toEqual([{ index: 2, reason: "line" }, { index: 3, reason: "market" }]);
  });

  it("never counts a leg the ticket's settlement could not name", () => {
    const slip = ticketSlip(prices, legs([q.ml, 1.6], [null, 2.1]));
    expect(slip.kind).toBe("partial");
    expect(slip.best).toMatchObject({ book: "Sportingbet", covered: [0], missing: [{ index: 1, reason: "market" }], full: false });
  });
});

describe("ranking", () => {
  it("puts full coverage ahead of a better price on part of the ticket", () => {
    const prices = [
      row("Superbet", "superbet", SB, { side: "home", decimal: 1.5 }),
      row("Superbet", "superbet", SB, prop("Ana Lima", "points", 17.5, "over", 1.5)),
      row("Sportingbet", "sportingbet", SPB, { side: "home", decimal: 4.5 }),
    ];
    const slip = ticketSlip(prices, legs([q.ml, 1.6], [q.lima, 1.9]));
    expect(slip.best!.book).toBe("Superbet");
    expect(slip.best!.decimal).toBeLessThan(slip.others[0].decimal);
  });

  it("puts a real betslip ahead of a page when two books carry the same legs", () => {
    const prices = [
      row("Betnacional", "betnacional", BN, { side: "home", decimal: 1.7 }),
      row("Sportingbet", "sportingbet", SPB, { side: "home", decimal: 1.7 }),
    ];
    const slip = ticketSlip(prices, legs([q.ml, 1.6]));
    expect(slip.best).toMatchObject({ book: "Sportingbet" });
    expect(slip.best!.link).toMatchObject({ kind: "betslip", selections: 1 });
    expect(slip.others[0].link).toMatchObject({ book: "Betnacional", kind: "event", selections: 0 });
  });

  it("drops a book with no URL scheme at all rather than guessing one", () => {
    const prices = [row("EstrelaBet", "altenar", AL, { side: "home", decimal: 2.5 })];
    const slip = ticketSlip(prices, legs([q.ml, 1.6]));
    expect(slip).toMatchObject({ kind: "none", best: null, others: [], nearLines: [] });
  });
});

describe("the near line", () => {
  // Ana Lima 17.5 points, both sides at Superbet: the no-vig chance of the over is ≈ 0.487.
  const both = (book: string, platform: string, ev: BookEvent, line: number, over: number, under: number) => [
    row(book, platform, ev, prop("Ana Lima", "points", line, "over", over)),
    row(book, platform, ev, prop("Ana Lima", "points", line, "under", under)),
  ];
  // Sportingbet carries two of the three legs and skips Ana Lima's line; Superbet posts that line
  // and nothing else, so the chance at the ticket's own rung is known without the book that misses it.
  const base = [
    row("Sportingbet", "sportingbet", SPB, { side: "home", decimal: 1.75 }),
    row("Sportingbet", "sportingbet", SPB, prop("Bia Souza", "rebounds", 6.5, "over", 1.88)),
    ...both("Superbet", "superbet", SB, 17.5, 1.95, 1.85),
  ];
  const ticket = legs([q.ml, 1.6], [q.lima, 1.9], [q.souza, 1.85]);

  it("offers the rung a book does post, as a different bet, with both prices and its own link", () => {
    const slip = ticketSlip([...base, ...both("Sportingbet", "sportingbet", SPB, 18.5, 2.1, 1.72)], ticket);
    expect(slip.kind).toBe("partial");
    expect(slip.best).toMatchObject({ book: "Sportingbet", covered: [0, 2], missing: [{ index: 1, reason: "line" }] });
    // Never folded in: the coverage count and the link's price describe the two legs it carries.
    expect(slip.best!.decimal).toBe(Number((1.75 * 1.88).toFixed(2)));
    expect(new URL(slip.best!.link.url).searchParams.get("options")!.split(",")).toHaveLength(2);
    expect(slip.nearLines).toHaveLength(1);
    // Both chances come from a no-vig pair: the model's own number on each rung, never one basis
    // measured against the other.
    expect(slip.nearLines[0]).toMatchObject({ index: 1, book: "Sportingbet", side: "over", basis: "fair" });
    expect(slip.nearLines[0].from).toMatchObject({ line: 17.5, decimal: 1.9 });
    expect(slip.nearLines[0].to).toMatchObject({ line: 18.5, decimal: 2.1 });
    expect(slip.nearLines[0].gap).toBeCloseTo(0.037, 2);
    expect(slip.nearLines[0].gap).toBeLessThan(NEAR_MAX_PROBABILITY_GAP);
    expect(slip.nearLines[0].link).toMatchObject({ book: "Sportingbet", kind: "betslip", selections: 1 });
  });

  it("refuses a rung the computed chance says is a different bet, even two points away", () => {
    // 19.5 at 4.00/1.22 is a ~23% over against a ~49% over: inside the points cap, a different opinion.
    const slip = ticketSlip([...base, ...both("Sportingbet", "sportingbet", SPB, 19.5, 4.0, 1.22)], ticket);
    expect(Math.abs(19.5 - 17.5)).toBeLessThanOrEqual(NEAR_MAX_LINE_MOVE.player_prop!);
    expect(slip.kind).toBe("partial");
    expect(slip.nearLines).toEqual([]);
  });

  it("refuses a rung too far away in points even when the price barely moved", () => {
    // 21.5 priced like 17.5: a flat price in a thin market is not evidence that it is the same bet.
    const slip = ticketSlip([...base, ...both("Sportingbet", "sportingbet", SPB, 21.5, 1.95, 1.85)], ticket);
    expect(slip.nearLines).toEqual([]);
  });

  it("measures both chances the same way: raw implied on both sides when a rung has only one side", () => {
    // Nobody posts the under at 18.5 and nobody posts 17.5 at all, so there is no no-vig pair on
    // either rung: both sides fall back to prices with the books' margin still in them, and the
    // ticket's own printed price stands in for the line no book posts.
    const prices = [
      row("Sportingbet", "sportingbet", SPB, { side: "home", decimal: 1.75 }),
      row("Sportingbet", "sportingbet", SPB, prop("Bia Souza", "rebounds", 6.5, "over", 1.88)),
      row("Sportingbet", "sportingbet", SPB, prop("Ana Lima", "points", 18.5, "over", 2.0)),
    ];
    const slip = ticketSlip(prices, ticket);
    expect(slip.nearLines).toHaveLength(1);
    expect(slip.nearLines[0]).toMatchObject({ basis: "implied", book: "Sportingbet" });
    expect(slip.nearLines[0].from).toMatchObject({ line: 17.5, decimal: 1.9 });
  });

  it("offers nothing for a leg a book already carries, and nothing beside a moneyline", () => {
    // Every leg covered: there is no gap for a near line to stand in.
    const whole = [...base, row("Sportingbet", "sportingbet", SPB, prop("Ana Lima", "points", 17.5, "over", 2.05))];
    expect(ticketSlip(whole, ticket)).toMatchObject({ kind: "full", nearLines: [] });
    // A moneyline has no rung beside it.
    expect(ticketSlip([row("Sportingbet", "sportingbet", SPB, { side: "away", decimal: 2.4 })], legs([q.ml, 1.6])).kind).toBe("none");
  });
});

describe("nothing matches", () => {
  it("says so plainly rather than building a link to a bet nobody posted", () => {
    const prices = [row("Superbet", "superbet", SB, prop("Eva Nunes", "assists", 4.5, "over", 1.9))];
    const slip = ticketSlip(prices, legs([q.lima, 1.9], [q.souza, 1.85]));
    expect(slip).toMatchObject({ kind: "none", best: null, others: [], nearLines: [], legs: 2 });
  });

  it("an empty ticket and an empty book list both come back empty", () => {
    expect(ticketSlip([], legs([q.ml, 1.6]))).toMatchObject({ kind: "none", best: null });
    expect(ticketSlip([row("Superbet", "superbet", SB, { side: "home", decimal: 1.6 })], [])).toMatchObject({ kind: "none", legs: 0 });
  });
});
