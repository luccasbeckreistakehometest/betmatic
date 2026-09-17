import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-weekly");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
process.env.TELEGRAM_BOT_TOKEN = "";
fs.rmSync(DIR, { recursive: true, force: true });

const { chasingEvents, isoWeek, kellyAdherence, lateNightShare, longShotMix, rollingWindow } = await import("@/lib/discipline");
const { runWeeklyReports, weeklyDue } = await import("@/lib/server/weekly-report");
const { getDb } = await import("@/lib/server/db");

const HOUR = 3_600_000;
const now = new Date("2026-09-21T13:00:00.000Z");
const at = (h: number) => new Date(now.getTime() - h * HOUR).toISOString();
const e = (createdH: number, stake: number, outcome: string, odds = 2, settledH: number | null = createdH - 2, modelled: number | null = null) =>
  ({ stake, odds, outcome, createdAt: at(createdH), settledAt: settledH === null ? null : at(settledH), modelled });

describe("discipline maths", () => {
  it("finds a bigger stake placed soon after a loss, and ignores one after a win or a long gap", () => {
    const entries = [e(50, 10, "lost", 2, 48), e(47, 20, "lost", 2, 45), e(30, 60, "won", 2, 28), e(27, 100, "lost"), e(10, 200, "lost")];
    const chases = chasingEvents(entries);
    expect(chases).toHaveLength(1);
    expect(chases[0]).toMatchObject({ stake: 20, previousStake: 10, minutesAfterLoss: 60 });
  });

  it("rolls returns over 7, 30 and 90 days on settled bets only", () => {
    const entries = [e(24, 10, "won", 3, 20), e(24 * 10, 10, "lost", 2, 24 * 10 - 1), e(24 * 60, 10, "won", 2, 24 * 60 - 1), e(2, 50, "pending", 2, null)];
    expect(rollingWindow(entries, 7, now)).toMatchObject({ bets: 1, staked: 10, profit: 20, roi: 2 });
    expect(rollingWindow(entries, 30, now)).toMatchObject({ bets: 2, profit: 10 });
    expect(rollingWindow(entries, 90, now)).toMatchObject({ bets: 3, profit: 20 });
  });

  it("reads stake sizing only against a declared bankroll", () => {
    const entries = [e(5, 100, "lost", 2, 3, 0.55), e(4, 5, "won", 2, 2, 0.55), e(3, 50, "won", 2)];
    expect(kellyAdherence(entries, null).share).toBeNull();
    const k = kellyAdherence(entries, 1000);
    expect(k).toMatchObject({ over: 1, sized: 2, share: 0.5 });
  });

  it("counts late-night bets in Brasília time and the cost of long shots", () => {
    const late = { ...e(1, 10, "pending"), createdAt: "2026-09-21T05:30:00.000Z" };
    const day = { ...e(1, 10, "pending"), createdAt: "2026-09-21T15:00:00.000Z" };
    expect(lateNightShare([late, day])).toEqual({ late: 1, share: 0.5 });
    const mix = longShotMix([e(1, 10, "pending", 50, null, 0.01), e(1, 30, "pending", 2, null)]);
    expect(mix.count).toBe(1);
    expect(mix.stakeShare).toBeCloseTo(0.25, 6);
    expect(mix.expectedCost).toBeCloseTo(10 * (1 - 0.5), 6);
    expect(isoWeek(new Date("2026-09-14T12:00:00Z"))).toBe("2026-W38");
    expect(weeklyDue(now)).toBe(true);
    expect(weeklyDue(new Date("2026-09-21T11:00:00Z"))).toBe(false);
  });
});

describe("weekly job", () => {
  it("writes one report per active user per week, and alerts only users who are not paused", async () => {
    const db = getDb();
    for (const id of ["active", "paused", "quiet"]) db.prepare("INSERT INTO users (id,email,name,passwordHash,role,planId,planPeriod,coins,lang,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, `${id}@example.com`, id, "x", "user", "free", "monthly", 0, "pt", at(500));
    const add = (userId: string, n: number) => {
      for (let i = 0; i < n; i++) db.prepare("INSERT INTO bankroll_entries (id,userId,source,title,combinedDecimal,stake,outcome,createdAt,settledAt) VALUES (?,?,?,?,?,?,?,?,?)").run(`${userId}-${i}`, userId, "manual", "x", 2, 10 + i * 10, "lost", at(40 - i * 2), at(39.5 - i * 2));
    };
    add("active", 3); add("paused", 3); add("quiet", 2);
    db.prepare("INSERT INTO user_settings (userId, pausedUntil, pausedAt, updatedAt) VALUES (?,?,?,?)").run("paused", new Date(now.getTime() + 7 * 24 * HOUR).toISOString(), at(1), at(1));
    expect((await runWeeklyReports({ now: new Date("2026-09-20T13:00:00Z") })).status).toBe("skipped");
    const first = await runWeeklyReports({ now });
    expect(first).toMatchObject({ status: "ok", users: 2, written: 2, notified: 1 });
    expect(db.prepare("SELECT userId, kind FROM alert_log").all()).toEqual([{ userId: "active", kind: "report" }]);
    const again = await runWeeklyReports({ now });
    expect(again).toMatchObject({ written: 0, notified: 0 });
    const stored = JSON.parse((db.prepare("SELECT payload FROM weekly_reports WHERE userId='active'").get() as { payload: string }).payload);
    expect(stored.chasing.length).toBeGreaterThan(0);
  });
});
