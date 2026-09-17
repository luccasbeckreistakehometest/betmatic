import { getDb, nowIso } from "@/lib/server/db";
import { listBankroll } from "@/lib/server/bankroll";
import { DAY_MS, DEFAULT_LIMITS, checkStake, isPaused, lossStreak, normaliseHandle, pauseDaysLeft, pauseUntil, streakNotice, type Limits, type PauseDays, type StakeCheck } from "@/lib/limits";

/**
 * Per-user settings: the responsible-gambling limits and the leaderboard consent. One row per
 * user, created on first write; readers get defaults until then.
 */
export interface SettingsView extends Limits {
  pausedAt: string | null;
  leaderboardOptIn: boolean;
  handle: string | null;
  updatedAt: string | null;
}

interface Row {
  userId: string; dailyStakeCap: number | null; weeklyStakeCap: number | null; sessionReminderMinutes: number | null; lossStreakNotice: number;
  pausedUntil: string | null; pausedAt: string | null; leaderboardOptIn: number; handle: string | null; updatedAt: string;
}

const read = (userId: string) => getDb().prepare("SELECT * FROM user_settings WHERE userId=?").get(userId) as Row | undefined;

function ensure(userId: string): Row {
  const row = read(userId);
  if (row) return row;
  getDb().prepare("INSERT INTO user_settings (userId, lossStreakNotice, updatedAt) VALUES (?,?,?)").run(userId, DEFAULT_LIMITS.lossStreakNotice, nowIso());
  return read(userId)!;
}

const view = (row: Row | undefined): SettingsView =>
  row
    ? { dailyStakeCap: row.dailyStakeCap, weeklyStakeCap: row.weeklyStakeCap, sessionReminderMinutes: row.sessionReminderMinutes, lossStreakNotice: row.lossStreakNotice, pausedUntil: row.pausedUntil, pausedAt: row.pausedAt, leaderboardOptIn: row.leaderboardOptIn === 1, handle: row.handle, updatedAt: row.updatedAt }
    : { ...DEFAULT_LIMITS, pausedAt: null, leaderboardOptIn: false, handle: null, updatedAt: null };

export const getSettings = (userId: string): SettingsView => view(read(userId));

export interface SettingsPatch {
  dailyStakeCap?: number | null; weeklyStakeCap?: number | null; sessionReminderMinutes?: number | null; lossStreakNotice?: number;
  leaderboardOptIn?: boolean; handle?: string | null;
}

export class HandleTakenError extends Error { constructor() { super("handle taken"); this.name = "HandleTakenError"; } }

export function updateSettings(userId: string, patch: SettingsPatch): SettingsView {
  const db = getDb();
  const row = ensure(userId);
  const next = {
    dailyStakeCap: patch.dailyStakeCap !== undefined ? patch.dailyStakeCap : row.dailyStakeCap,
    weeklyStakeCap: patch.weeklyStakeCap !== undefined ? patch.weeklyStakeCap : row.weeklyStakeCap,
    sessionReminderMinutes: patch.sessionReminderMinutes !== undefined ? patch.sessionReminderMinutes : row.sessionReminderMinutes,
    lossStreakNotice: patch.lossStreakNotice !== undefined ? patch.lossStreakNotice : row.lossStreakNotice,
    leaderboardOptIn: patch.leaderboardOptIn !== undefined ? (patch.leaderboardOptIn ? 1 : 0) : row.leaderboardOptIn,
    handle: patch.handle !== undefined ? (patch.handle === null ? null : normaliseHandle(patch.handle)) : row.handle,
  };
  if (patch.handle && !next.handle) throw new Error("handle inválido");
  // Consent without a name to show under is meaningless: opting in mints a pseudonym when none was chosen.
  if (next.leaderboardOptIn === 1 && !next.handle) next.handle = defaultHandle(userId);
  try {
    db.prepare("UPDATE user_settings SET dailyStakeCap=?, weeklyStakeCap=?, sessionReminderMinutes=?, lossStreakNotice=?, leaderboardOptIn=?, handle=?, updatedAt=? WHERE userId=?")
      .run(next.dailyStakeCap, next.weeklyStakeCap, next.sessionReminderMinutes, next.lossStreakNotice, next.leaderboardOptIn, next.handle, nowIso(), userId);
  } catch (error) {
    if (error instanceof Error && /UNIQUE/.test(error.message)) throw new HandleTakenError();
    throw error;
  }
  return getSettings(userId);
}

/** A stable pseudonym from the user id — never the name or e-mail. */
export function defaultHandle(userId: string): string {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `apostador_${h.toString(36).slice(-5)}`;
}

/** Self-exclusion. Extending an active pause only ever pushes the date later. */
export function pauseUser(userId: string, days: PauseDays, now = new Date()): SettingsView {
  const row = ensure(userId);
  const until = pauseUntil(now, days);
  const keep = row.pausedUntil && row.pausedUntil > until ? row.pausedUntil : until;
  getDb().prepare("UPDATE user_settings SET pausedUntil=?, pausedAt=COALESCE(pausedAt, ?), updatedAt=? WHERE userId=?").run(keep, now.toISOString(), nowIso(), userId);
  return getSettings(userId);
}

export function pauseState(userId: string, now = Date.now()): { paused: boolean; until: string | null; daysLeft: number } {
  const s = getSettings(userId);
  const paused = isPaused(s.pausedUntil, now);
  return { paused, until: paused ? s.pausedUntil : null, daysLeft: pauseDaysLeft(s.pausedUntil, now) };
}

/** Money put at risk inside the rolling windows — every logged bet counts, settled or not. */
export function stakedWindows(userId: string, now = Date.now()): { today: number; week: number } {
  const db = getDb();
  const sum = (since: string) => (db.prepare("SELECT COALESCE(SUM(stake),0) s FROM bankroll_entries WHERE userId=? AND createdAt > ?").get(userId, since) as { s: number }).s;
  return { today: sum(new Date(now - DAY_MS).toISOString()), week: sum(new Date(now - 7 * DAY_MS).toISOString()) };
}

export function stakeVerdict(userId: string, stake: number, now = Date.now()): StakeCheck {
  return checkStake(getSettings(userId), stakedWindows(userId, now), stake);
}

export function currentStreak(userId: string): { streak: number; notice: boolean } {
  const s = getSettings(userId);
  const streak = lossStreak(listBankroll(userId).entries.map((e) => ({ outcome: e.outcome, at: e.settledAt ?? e.createdAt })));
  return { streak, notice: streakNotice(streak, s.lossStreakNotice) };
}

/** Aggregate only: the admin sees how many people use the tools, never who. */
export function responsibleStats(now = nowIso()) {
  const db = getDb();
  const one = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { c: number }).c;
  return {
    withLimits: one("SELECT COUNT(*) c FROM user_settings WHERE dailyStakeCap IS NOT NULL OR weeklyStakeCap IS NOT NULL"),
    reminders: one("SELECT COUNT(*) c FROM user_settings WHERE sessionReminderMinutes IS NOT NULL"),
    paused: one("SELECT COUNT(*) c FROM user_settings WHERE pausedUntil > ?", now),
    everPaused: one("SELECT COUNT(*) c FROM user_settings WHERE pausedAt IS NOT NULL"),
    leaderboardOptIn: one("SELECT COUNT(*) c FROM user_settings WHERE leaderboardOptIn=1"),
  };
}
