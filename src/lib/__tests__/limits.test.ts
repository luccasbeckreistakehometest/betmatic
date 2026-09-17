import { describe, expect, it } from "vitest";
import { checkStake, isPaused, lossStreak, normaliseHandle, pauseDaysLeft, pauseUntil, reminderCount, streakNotice } from "@/lib/limits";

describe("stake ceilings", () => {
  it("allows anything without ceilings", () => {
    expect(checkStake({ dailyStakeCap: null, weeklyStakeCap: null }, { today: 999, week: 9999 }, 1_000_000)).toEqual({ allowed: true, reason: null, remainingDaily: null, remainingWeekly: null });
  });
  it("blocks on the daily ceiling first, then the weekly one, and reports what is left", () => {
    const limits = { dailyStakeCap: 100, weeklyStakeCap: 300 };
    expect(checkStake(limits, { today: 60, week: 60 }, 40)).toMatchObject({ allowed: true, remainingDaily: 40, remainingWeekly: 240 });
    expect(checkStake(limits, { today: 60, week: 60 }, 40.01)).toMatchObject({ allowed: false, reason: "daily", remainingDaily: 40 });
    expect(checkStake(limits, { today: 0, week: 280 }, 30)).toMatchObject({ allowed: false, reason: "weekly", remainingWeekly: 20 });
    expect(checkStake(limits, { today: 150, week: 150 }, 1)).toMatchObject({ allowed: false, reason: "daily", remainingDaily: 0 });
    expect(checkStake({ dailyStakeCap: 0.3, weeklyStakeCap: null }, { today: 0.1, week: 0.1 }, 0.2).allowed).toBe(true); // float-safe
  });
});

describe("pause", () => {
  const now = new Date("2026-09-17T12:00:00Z");
  it("runs for exactly the chosen days and cannot be shortened by reading", () => {
    const until = pauseUntil(now, 7);
    expect(until).toBe("2026-09-24T12:00:00.000Z");
    expect(isPaused(until, now.getTime())).toBe(true);
    expect(isPaused(until, Date.parse("2026-09-24T12:00:00.001Z"))).toBe(false);
    expect(isPaused(null)).toBe(false);
    expect(pauseDaysLeft(until, now.getTime())).toBe(7);
    expect(pauseDaysLeft(until, Date.parse("2026-09-23T13:00:00Z"))).toBe(1);
    expect(pauseDaysLeft(until, Date.parse("2026-09-25T00:00:00Z"))).toBe(0);
    expect(pauseUntil(now, 30)).toBe("2026-10-17T12:00:00.000Z");
  });
});

describe("losing streak", () => {
  const e = (outcome: string, day: number) => ({ outcome, at: `2026-09-${String(day).padStart(2, "0")}T00:00:00Z` });
  it("counts consecutive losses back from the latest decided bet, skipping pushes and pending", () => {
    expect(lossStreak([e("lost", 3), e("lost", 2), e("won", 1)])).toBe(2);
    expect(lossStreak([e("won", 3), e("lost", 2), e("lost", 1)])).toBe(0);
    expect(lossStreak([e("pending", 5), e("push", 4), e("lost", 3), e("void", 2), e("lost", 1)])).toBe(2);
    expect(lossStreak([e("lost", 1), e("lost", 3), e("won", 2)])).toBe(1); // order comes from `at`, not array order
    expect(lossStreak([])).toBe(0);
  });
  it("notices only at or above the threshold, and never when switched off", () => {
    expect(streakNotice(3, 3)).toBe(true);
    expect(streakNotice(2, 3)).toBe(false);
    expect(streakNotice(9, 0)).toBe(false);
  });
});

describe("session reminder", () => {
  it("counts elapsed intervals; off when unset", () => {
    const start = Date.parse("2026-09-17T12:00:00Z");
    expect(reminderCount(start, 30, start + 29 * 60_000)).toBe(0);
    expect(reminderCount(start, 30, start + 30 * 60_000)).toBe(1);
    expect(reminderCount(start, 30, start + 95 * 60_000)).toBe(3);
    expect(reminderCount(start, null, start + 95 * 60_000)).toBe(0);
    expect(reminderCount(start, 30, start - 1)).toBe(0);
  });
});

describe("handles", () => {
  it("accepts 3–16 lower-case letters, digits and underscores, dropping a leading @", () => {
    expect(normaliseHandle("@Luccas_BR")).toBe("luccas_br");
    expect(normaliseHandle("ab")).toBeNull();
    expect(normaliseHandle("has space")).toBeNull();
    expect(normaliseHandle("x".repeat(17))).toBeNull();
    expect(normaliseHandle(null)).toBeNull();
  });
});
