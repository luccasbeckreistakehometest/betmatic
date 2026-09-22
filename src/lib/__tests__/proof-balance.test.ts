import { describe, expect, it } from "vitest";
import { brasiliaDay, dayBalances, proofStats } from "@/lib/ledger/proof";
import type { LedgerEntry } from "@/lib/types";

const entry = (id: string, outcome: LedgerEntry["outcome"], combinedDecimal: number, settledAt: string, scope?: "live"): LedgerEntry => ({
  id, gameId: "g", sportKey: "wnba", matchup: "A @ B", createdAt: settledAt, startsAt: settledAt, settledAt, bandKey: "mid", kind: "parlay", title: id,
  combinedDecimal, modelledProbability: 0.3, outcome, ...(scope ? { scope, minute: 20, period: 2 } : {}), legs: [],
});

// The owner's rule after 21/09/2026: every ticket counts, and the balance is readable per day.
describe("the balance, overall and per Brasília day", () => {
  it("counts live tickets beside the pre-game ones and splits the day", () => {
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
    const days = dayBalances(rows);
    // The pending ticket kicks off 22:00 BRT on the 22nd, so it sits on that day, undecided.
    expect(days.map((d) => d.day)).toEqual(["2026-09-22", "2026-09-20"]);
    const d = days[0];
    expect(d).toMatchObject({ generated: 5, pending: 1, settled: 4, won: 2, lost: 2, unitsStaked: 4, live: { settled: 2, won: 1 } });
    expect(d.unitsReturned).toBeCloseTo(1.38 + 14.65, 6);
    expect(d.roi).toBeCloseTo((1.38 + 14.65 - 4) / 4, 6);
    expect(d.live.unitsReturned).toBeCloseTo(14.65, 6);
    expect(days[1]).toMatchObject({ day: "2026-09-20", settled: 1, won: 1, unitsReturned: 2 });
  });

  it("puts a pending ticket on the day of its kickoff, in Brasília time", () => {
    expect(brasiliaDay("2026-09-23T01:00:00.000Z")).toBe("2026-09-22");
    expect(brasiliaDay("2026-09-23T03:30:00.000Z")).toBe("2026-09-23");
    expect(brasiliaDay(undefined, "x")).toBe("x");
    expect(dayBalances([entry("open", "pending", 3, "2026-09-23T01:00:00.000Z")])[0]).toMatchObject({ day: "2026-09-22", pending: 1 });
  });
});
