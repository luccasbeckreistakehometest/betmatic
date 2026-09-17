/**
 * Responsible-gambling rules as pure functions: stake ceilings, the self-exclusion pause, the
 * losing-streak notice, the session reminder and the leaderboard handle. No database, no clock of
 * their own — every caller passes `now`, so each rule is testable to the minute.
 */
export interface Limits {
  /** Ceiling on money put at risk in the last 24 hours; null = no ceiling. */
  dailyStakeCap: number | null;
  /** Ceiling on money put at risk in the last 7 days; null = no ceiling. */
  weeklyStakeCap: number | null;
  /** A reminder every N minutes of an open session; null = off. */
  sessionReminderMinutes: number | null;
  /** Notice after N consecutive lost bets; 0 = off. */
  lossStreakNotice: number;
  pausedUntil: string | null;
}

export const DEFAULT_LIMITS: Limits = { dailyStakeCap: null, weeklyStakeCap: null, sessionReminderMinutes: null, lossStreakNotice: 3, pausedUntil: null };
export const PAUSE_DAYS = [7, 30] as const;
export type PauseDays = (typeof PAUSE_DAYS)[number];
export const DAY_MS = 86_400_000;

export const isPaused = (pausedUntil: string | null | undefined, now = Date.now()): boolean => !!pausedUntil && Date.parse(pausedUntil) > now;

/** A pause is a promise to oneself: it ends on its date, never early. */
export function pauseUntil(now: Date, days: PauseDays): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

export function pauseDaysLeft(pausedUntil: string | null | undefined, now = Date.now()): number {
  if (!isPaused(pausedUntil, now)) return 0;
  return Math.ceil((Date.parse(pausedUntil!) - now) / DAY_MS);
}

export interface StakeCheck {
  allowed: boolean;
  reason: "daily" | "weekly" | null;
  remainingDaily: number | null;
  remainingWeekly: number | null;
}

/** `staked` is what is already at risk inside each rolling window; the new stake must fit in both. */
export function checkStake(limits: Pick<Limits, "dailyStakeCap" | "weeklyStakeCap">, staked: { today: number; week: number }, stake: number): StakeCheck {
  const remainingDaily = limits.dailyStakeCap === null ? null : Math.max(0, round2(limits.dailyStakeCap - staked.today));
  const remainingWeekly = limits.weeklyStakeCap === null ? null : Math.max(0, round2(limits.weeklyStakeCap - staked.week));
  if (remainingDaily !== null && stake > remainingDaily + 1e-9) return { allowed: false, reason: "daily", remainingDaily, remainingWeekly };
  if (remainingWeekly !== null && stake > remainingWeekly + 1e-9) return { allowed: false, reason: "weekly", remainingDaily, remainingWeekly };
  return { allowed: true, reason: null, remainingDaily, remainingWeekly };
}

/** Consecutive losses counting back from the most recently decided bet; pushes, voids and pending are skipped. */
export function lossStreak(entries: { outcome: string; at: string }[]): number {
  const decided = entries.filter((e) => e.outcome === "won" || e.outcome === "lost").sort((a, b) => b.at.localeCompare(a.at));
  let n = 0;
  for (const e of decided) { if (e.outcome === "lost") n += 1; else break; }
  return n;
}

export const streakNotice = (streak: number, threshold: number): boolean => threshold > 0 && streak >= threshold;

/** How many reminder intervals have elapsed since the session started; the UI speaks when it grows. */
export function reminderCount(startedAt: number, minutes: number | null, now: number): number {
  if (!minutes || minutes <= 0 || now <= startedAt) return 0;
  return Math.floor((now - startedAt) / (minutes * 60_000));
}

/** Leaderboard handles: 3–16 chars of a–z, 0–9 and underscore, lower-cased. Null when unusable. */
export function normaliseHandle(raw: string | null | undefined): string | null {
  const h = (raw ?? "").trim().toLowerCase().replace(/^@/, "");
  return /^[a-z0-9_]{3,16}$/.test(h) ? h : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
