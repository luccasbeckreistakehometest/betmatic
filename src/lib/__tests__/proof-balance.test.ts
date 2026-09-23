import { describe, expect, it } from "vitest";
import { brasiliaDay, dayBalances, proofStats } from "@/lib/ledger/proof";
import type { LedgerEntry } from "@/lib/types";

const entry = (id: string, outcome: LedgerEntry["outcome"], combinedDecimal: number, settledAt: string, scope?: "live"): LedgerEntry => ({
  id, gameId: "g", sportKey: "wnba", matchup: "A @ B", createdAt: settledAt, startsAt: settledAt, settledAt, bandKey: "mid", kind: "parlay", title: id,
  combinedDecimal, modelledProbability: 0.3, outcome, ...(scope ? { scope, minute: 20, period: 2 } : {}), legs: [],
});

// The owner's rule after 21/09/2026: every ticket counts, and the balance is readable per day.
describe("the balance, overall and per Brasília day", () => {
  it("counts the money on the pre-game tickets only, and the live ones beside it without units", () => {
    const rows = [
      entry("pre-w", "won", 1.38, "2026-09-22T03:10:00.000Z"),           // 22/09 00:10 BRT
      entry("pre-l", "lost", 5.34, "2026-09-22T03:10:00.000Z"),
      entry("live-w", "won", 14.65, "2026-09-22T03:12:00.000Z", "live"),
      entry("live-l", "lost", 13.06, "2026-09-22T03:12:00.000Z", "live"),
      entry("older", "won", 2, "2026-09-20T20:00:00.000Z"),
      entry("open", "pending", 3, "2026-09-23T01:00:00.000Z"),
    ];
    const s = proofStats(rows);
    expect(s.byScope.map((r) => [r.key, r.settled, r.won])).toEqual([["pregame", 3, 2], ["live", 2, 1]]);
    // The live line carries counts and no ROI at all — there is no price behind it.
    expect(s.byScope.find((r) => r.key === "live")).not.toHaveProperty("roi");
    expect(s.unitsStaked).toBe(3);
    expect(s.unitsReturned).toBeCloseTo(3 + (1.38 - 1) - 1 + (2 - 1), 6);
    expect(s.roi).toBeCloseTo((1.38 - 1 - 1 + 2 - 1) / 3, 6);
    const days = dayBalances(rows);
    // The pending ticket kicks off 22:00 BRT on the 22nd, so it sits on that day, undecided.
    expect(days.map((d) => d.day)).toEqual(["2026-09-22", "2026-09-20"]);
    const d = days[0];
    // `settled`/`won`/`lost` describe the pre-game tickets the units are staked on — two of them,
    // one won — not every scope and every non-pending outcome. Counting those made a day row read
    // larger than the whole record. What the day produced is `generated`; the live pair is `live`.
    expect(d).toMatchObject({ generated: 5, pending: 1, settled: 2, won: 1, lost: 1, unitsStaked: 2, live: { settled: 2, won: 1 } });
    // Two pre-game tickets, one of them home at 1.38: the live 14.65 never touches the balance.
    expect(d.unitsReturned).toBeCloseTo(1.38, 6);
    expect(d.roi).toBeCloseTo((1.38 - 2) / 2, 6);
    expect(d.live).not.toHaveProperty("unitsReturned");
    expect(d.live.expectedWins).toBeCloseTo(0.6, 6);
    expect(d.live.gapPoints).toBeCloseTo(((1 - 0.6) / 2) * 100, 6);
    expect(days[1]).toMatchObject({ day: "2026-09-20", settled: 1, won: 1, unitsReturned: 2 });
  });

  it("puts a pending ticket on the day of its kickoff, in Brasília time", () => {
    expect(brasiliaDay("2026-09-23T01:00:00.000Z")).toBe("2026-09-22");
    expect(brasiliaDay("2026-09-23T03:30:00.000Z")).toBe("2026-09-23");
    expect(brasiliaDay(undefined, "x")).toBe("x");
    expect(dayBalances([entry("open", "pending", 3, "2026-09-23T01:00:00.000Z")])[0]).toMatchObject({ day: "2026-09-22", pending: 1 });
  });
});

/**
 * On 23/09/2026 the public balance read "Geral 36 bilhetes · Hoje 103" — more tickets on one day
 * than in the whole record, which is impossible and was the first thing a reader would notice. The
 * Geral row counted decided PRE-GAME tickets, while each day row counted every scope and every
 * non-pending outcome, voids included. A pre-game table has to count the tickets it stakes on.
 */
describe("the balance counts the tickets it stakes on", () => {
  const day = "2026-09-23T01:00:00.000Z";
  const rows = [
    entry("pre-won", "won", 2.0, day),
    entry("pre-lost", "lost", 3.0, day),
    entry("pre-void", "void", 4.0, day),
    entry("pre-pending", "pending", 5.0, day),
    { ...entry("live-won", "won", 6.0, day), scope: "live" as const },
    { ...entry("live-lost", "lost", 7.0, day), scope: "live" as const },
  ];

  it("leaves live reads, voids and pending out of the day's ticket and hit counts", () => {
    const [d] = dayBalances(rows);
    expect(d.settled).toBe(2);
    expect(d.won).toBe(1);
    expect(d.lost).toBe(1);
    // The units are staked on exactly those tickets.
    expect(d.unitsStaked).toBe(d.settled);
    expect(d.live.settled).toBe(2);
    expect(d.live.won).toBe(1);
  });

  it("still reports everything the day produced, so nothing is hidden", () => {
    const [d] = dayBalances(rows);
    expect(d.generated).toBe(6);
    expect(d.pending).toBe(1);
  });

  it("never puts more tickets on one day than the whole record has", () => {
    const s = proofStats(rows);
    const overall = s.won + s.lost;
    for (const d of s.byDay) {
      expect(d.settled).toBeLessThanOrEqual(overall);
      expect(d.won).toBeLessThanOrEqual(s.won);
    }
    expect(s.byDay.reduce((a, d) => a + d.settled, 0)).toBe(overall);
  });
});
