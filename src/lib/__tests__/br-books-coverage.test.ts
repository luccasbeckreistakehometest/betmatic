import { describe, expect, it } from "vitest";
import { booksCopy, candidateLabel, reachNote } from "@/components/books-copy";
import { NEAR_MAX_LINE_MOVE, NEAR_MAX_PROBABILITY_GAP, ticketSlip, type BookCandidate, type SlipLeg } from "@/lib/sources/br-books/coverage";
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

  /**
   * The ladder, whole: one fetch round publishes several rungs of the same prop at one book, every
   * row stamped with the same `fetchedAt`. The rung offered has to be the one nearest the number on
   * the ticket — which is only possible if all of them reach the comparison.
   */
  describe("out of a whole ladder", () => {
    const ladder = [
      row("Sportingbet", "sportingbet", SPB, prop("Ana Lima", "points", 16.5, "over", 1.55)),
      row("Sportingbet", "sportingbet", SPB, prop("Ana Lima", "points", 18.5, "over", 2.1)),
      // "20+" is posted as a milestone rung, a different `kind` on the same ladder.
      row("Sportingbet", "sportingbet", SPB, { ...prop("Ana Lima", "points", 19.5, "over", 2.45), kind: "milestone" }),
    ];

    it("offers the rung nearest the ticket's number, not the first row nor the longest price", () => {
      const slip = ticketSlip([...base, ...ladder], ticket);
      expect(slip.nearLines).toHaveLength(1);
      // 16.5 and 18.5 are both one step away; 18.5 is the one still recognisably this bet (a ~48%
      // over against the ticket's ~51%, where 16.5 is a ~65% over), and 19.5 is two steps out.
      expect(slip.nearLines[0]).toMatchObject({ index: 1, book: "Sportingbet", side: "over", basis: "implied" });
      expect(slip.nearLines[0].to).toMatchObject({ line: 18.5, decimal: 2.1 });
      expect(slip.nearLines[0].gap).toBeCloseTo(0.0366, 4);
      expect(slip.nearLines[0].gap).toBeLessThan(NEAR_MAX_PROBABILITY_GAP);
    });

    it("gives the same answer with the ladder as with that rung alone: more data never means less offer", () => {
      const whole = ticketSlip([...base, ...ladder], ticket);
      const alone = ticketSlip([...base, ladder[1]], ticket);
      expect(alone.nearLines).toHaveLength(1);
      expect(whole.nearLines).toEqual(alone.nearLines);
    });

    it("keeps the nearest rung even when one further out prices closer to the ticket", () => {
      // 19.5 was left at 1,98 while 18.5 moved to 2,30: a stale rung two steps away reads as the
      // same chance as the ticket's line. It is still not the number the reader asked for.
      const stale = [
        row("Sportingbet", "sportingbet", SPB, prop("Ana Lima", "points", 18.5, "over", 2.3)),
        row("Sportingbet", "sportingbet", SPB, prop("Ana Lima", "points", 19.5, "over", 1.98)),
      ];
      const slip = ticketSlip([...base, ...stale], ticket);
      expect(slip.nearLines[0].to).toMatchObject({ line: 18.5, decimal: 2.3 });
      // The rung that was not offered really was the closer one in chance: distance decided, and
      // the offered gap is the bigger of the two.
      expect(slip.nearLines[0].gap).toBeCloseTo(0.078, 3);
    });

    it("offers nothing when the book's own next rung is already a different bet", () => {
      // The nearest rung is put to the chance gate and fails it. The stale 19.5 two steps out would
      // pass, and is not offered instead: a step the book itself calls a different bet cannot be
      // rescued by a longer step whose price has not moved.
      const jump = [
        row("Sportingbet", "sportingbet", SPB, prop("Ana Lima", "points", 18.5, "over", 2.6)),
        row("Sportingbet", "sportingbet", SPB, prop("Ana Lima", "points", 19.5, "over", 1.95)),
      ];
      expect(ticketSlip([...base, ...jump], ticket).nearLines).toEqual([]);
    });
  });

  it("offers nothing for a leg a book already carries, and nothing beside a moneyline", () => {
    // Every leg covered: there is no gap for a near line to stand in.
    const whole = [...base, row("Sportingbet", "sportingbet", SPB, prop("Ana Lima", "points", 17.5, "over", 2.05))];
    expect(ticketSlip(whole, ticket)).toMatchObject({ kind: "full", nearLines: [] });
    // A moneyline has no rung beside it.
    expect(ticketSlip([row("Sportingbet", "sportingbet", SPB, { side: "away", decimal: 2.4 })], legs([q.ml, 1.6])).kind).toBe("none");
  });
});

describe("what the link carries", () => {
  /** The same row with one id missing: rows stored before deep links existed carry none. */
  const withoutUuid = (p: BookPrice): BookPrice => ({ ...p, ref: { ...p.ref, uuid: undefined } });

  // Superbet prices all three legs, but the third row has no odd uuid, so the whole-slip URL cannot
  // be built and the link falls back to a single — the same book, the same coverage, ONE bet in the
  // URL. Coverage and reach are different facts and the candidate carries both.
  const prices = [
    row("Superbet", "superbet", SB, { side: "home", decimal: 1.62 }),
    row("Superbet", "superbet", SB, prop("Ana Lima", "points", 17.5, "over", 1.95)),
    withoutUuid(row("Superbet", "superbet", SB, prop("Bia Souza", "rebounds", 6.5, "over", 1.88))),
  ];
  const three = legs([q.ml, 1.6], [q.lima, 1.9], [q.souza, 1.85]);

  it("keeps the price the book quotes apart from the price the URL pre-fills", () => {
    const best = ticketSlip(prices, three).best!;
    // The book covers everything: that is still true, and still what "3 das 3 linhas" counts.
    expect(best).toMatchObject({ book: "Superbet", covered: [0, 1, 2], full: true, decimal: Number((1.62 * 1.95 * 1.88).toFixed(2)) });
    // The URL carries the first leg and only it, and its price is the first leg's price alone.
    expect(best.carried).toEqual([0]);
    expect(best.carriedDecimal).toBe(1.62);
    expect(best.link).toMatchObject({ kind: "betslip", selections: 1 });
    expect(new URL(best.link.url).searchParams.getAll("bets[]")).toHaveLength(1);
  });

  it("says one das três on the button, and says the coverage in its own words", () => {
    const best = ticketSlip(prices, three).best!;
    expect(candidateLabel(best, 3, "pt")).toBe("Abrir na Superbet com 1 das 3 linhas");
    expect(reachNote(best, 3, "pt")).toBe("a casa cota as 3 linhas, mas o link carrega só 1");
    expect(candidateLabel(best, 3, "en")).toBe("Open at Superbet with 1 of 3 lines");
  });

  it("offers a page as a page, with no ticket and no price of its own", () => {
    const best = ticketSlip([row("Betnacional", "betnacional", BN, { side: "home", decimal: 1.7 })], legs([q.ml, 1.6])).best!;
    expect(best).toMatchObject({ book: "Betnacional", covered: [0], full: true, carried: [], carriedDecimal: null });
    expect(best.link).toMatchObject({ kind: "event", selections: 0 });
    expect(candidateLabel(best, 1, "pt")).toBe("Abrir a página na Betnacional");
    expect(reachNote(best, 1, "pt")).toBe("a casa cota essa linha, mas o link só abre a página: o bilhete tem que ser montado lá");
  });

  it("still says o bilhete inteiro when the URL really carries every leg", () => {
    const whole = [prices[0], prices[1], row("Superbet", "superbet", SB, prop("Bia Souza", "rebounds", 6.5, "over", 1.88))];
    const best = ticketSlip(whole, three).best!;
    expect(best.carried).toEqual([0, 1, 2]);
    expect(best.carriedDecimal).toBe(Number((1.62 * 1.95 * 1.88).toFixed(2)));
    expect(candidateLabel(best, 3, "pt")).toBe("Abrir o bilhete inteiro na Superbet");
    expect(reachNote(best, 3, "pt")).toBeNull();
  });

  /**
   * The invariant, in one line: whatever the label says, it is never more than the number of
   * selections the URL pre-fills. "o bilhete inteiro" promises every leg; "com N das M" promises N;
   * "abrir a página" promises none. A label that promised more than `link.selections` would be a
   * reader placing a bet they did not read.
   */
  const promised = (c: BookCandidate, of: number): number => {
    const label = candidateLabel(c, of, "pt");
    if (label.includes(booksCopy("pt")("openTicketAt"))) return of;
    return Number(label.match(/ (\d+) /)?.[1] ?? 0);
  };

  it("never promises more than the URL pre-fills, on any book of any ticket", () => {
    const every = [
      ...prices,
      row("Sportingbet", "sportingbet", SPB, { side: "home", decimal: 1.75 }),
      row("Sportingbet", "sportingbet", SPB, prop("Ana Lima", "points", 17.5, "over", 2.2)),
      row("Betnacional", "betnacional", BN, { side: "home", decimal: 1.7 }),
      row("Betnacional", "betnacional", BN, prop("Ana Lima", "points", 17.5, "over", 2.05)),
    ];
    const slip = ticketSlip(every, three);
    const candidates = [slip.best!, ...slip.others];
    expect(candidates).toHaveLength(3);
    for (const c of candidates) {
      expect(c.carried.length).toBe(c.link.selections);
      expect(c.carried.every((i) => c.covered.includes(i))).toBe(true);
      expect(promised(c, 3)).toBeLessThanOrEqual(c.link.selections);
    }
    // And the three books really do exercise the three shapes: a whole slip, a fallback single, a page.
    expect(candidates.map((c) => c.link.selections).sort()).toEqual([0, 1, 2]);
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
