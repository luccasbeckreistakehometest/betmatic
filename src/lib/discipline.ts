import { kellyFraction } from "@/lib/odds";

/**
 * Relatório semanal de disciplina: a mirror of how the user has been betting — rolling returns,
 * chasing after a loss, late-night bets, stakes past a sane sizing, and how much of the week went
 * into long shots. Pure; it never suggests raising a stake.
 */
export interface DisciplineEntry {
  stake: number;
  odds: number;
  outcome: string;
  createdAt: string;
  settledAt: string | null;
  /** The ticket's modelled chance when the product built it. */
  modelled?: number | null;
  /** Mean CLV of its legs, when known. */
  clv?: number | null;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const decided = (e: DisciplineEntry) => e.outcome === "won" || e.outcome === "lost";
const pnl = (e: DisciplineEntry) => (e.outcome === "won" ? e.stake * (e.odds - 1) : e.outcome === "lost" ? -e.stake : 0);

export interface Window { days: number; bets: number; staked: number; profit: number; roi: number | null }

export function rollingWindow(entries: DisciplineEntry[], days: number, now: Date): Window {
  const since = now.getTime() - days * DAY;
  const inWindow = entries.filter((e) => decided(e) && Date.parse(e.settledAt ?? e.createdAt) >= since && Date.parse(e.settledAt ?? e.createdAt) <= now.getTime());
  const staked = inWindow.reduce((a, e) => a + e.stake, 0);
  const profit = inWindow.reduce((a, e) => a + pnl(e), 0);
  return { days, bets: inWindow.length, staked, profit, roi: staked ? profit / staked : null };
}

export interface Chase { at: string; stake: number; previousStake: number; minutesAfterLoss: number }

/** A stake at least 1.5× the previous one, placed within 3 hours of that previous bet being lost. */
export function chasingEvents(entries: DisciplineEntry[]): Chase[] {
  const ordered = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const out: Chase[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (prev.outcome !== "lost") continue;
    const lostAt = Date.parse(prev.settledAt ?? prev.createdAt);
    const gap = Date.parse(cur.createdAt) - lostAt;
    if (gap >= 0 && gap <= 3 * HOUR && cur.stake >= 1.5 * prev.stake) {
      out.push({ at: cur.createdAt, stake: cur.stake, previousStake: prev.stake, minutesAfterLoss: Math.round(gap / 60_000) });
    }
  }
  return out;
}

/** Share of sized bets staked above twice the quarter-Kelly suggestion. Null without a declared bankroll. */
export function kellyAdherence(entries: DisciplineEntry[], bankroll: number | null): { over: number; sized: number; share: number | null } {
  if (!bankroll || bankroll <= 0) return { over: 0, sized: 0, share: null };
  const sized = entries.filter((e) => e.modelled !== null && e.modelled !== undefined && e.modelled > 0);
  const over = sized.filter((e) => {
    const suggested = kellyFraction(e.odds, e.modelled!) * bankroll;
    return e.stake > Math.max(2 * suggested, 0.005 * bankroll);
  }).length;
  return { over, sized: sized.length, share: sized.length ? over / sized.length : null };
}

/** Bets placed between midnight and 5am in Brasília. */
export function lateNightShare(entries: DisciplineEntry[]): { late: number; share: number | null } {
  const hour = (iso: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(new Date(iso)));
  const late = entries.filter((e) => hour(e.createdAt) < 5).length;
  return { late, share: entries.length ? late / entries.length : null };
}

/** Long shots (20x or more): their share of the money, and what they are expected to cost. */
export function longShotMix(entries: DisciplineEntry[]): { count: number; stakeShare: number | null; expectedCost: number | null } {
  const long = entries.filter((e) => e.odds >= 20);
  const total = entries.reduce((a, e) => a + e.stake, 0);
  const priced = long.filter((e) => e.modelled);
  return {
    count: long.length,
    stakeShare: total ? long.reduce((a, e) => a + e.stake, 0) / total : null,
    expectedCost: priced.length ? priced.reduce((a, e) => a + e.stake * (1 - e.modelled! * e.odds), 0) : null,
  };
}

export interface WeeklyPayload {
  weekKey: string;
  from: string;
  to: string;
  bets: number;
  windows: Window[];
  clv: number | null;
  chasing: Chase[];
  kelly: ReturnType<typeof kellyAdherence>;
  lateNight: ReturnType<typeof lateNightShare>;
  longShots: ReturnType<typeof longShotMix>;
}

/** ISO week of a date, e.g. "2026-W38". */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function weeklyReport(all: DisciplineEntry[], opts: { now: Date; bankroll: number | null }): WeeklyPayload {
  const from = new Date(opts.now.getTime() - 7 * DAY);
  const week = all.filter((e) => Date.parse(e.createdAt) >= from.getTime() && Date.parse(e.createdAt) <= opts.now.getTime());
  const withClv = week.filter((e) => e.clv !== null && e.clv !== undefined && Number.isFinite(e.clv));
  return {
    weekKey: isoWeek(from),
    from: from.toISOString(),
    to: opts.now.toISOString(),
    bets: week.length,
    windows: [7, 30, 90].map((d) => rollingWindow(all, d, opts.now)),
    clv: withClv.length ? withClv.reduce((a, e) => a + e.clv!, 0) / withClv.length : null,
    chasing: chasingEvents(week),
    kelly: kellyAdherence(week, opts.bankroll),
    lateNight: lateNightShare(week),
    longShots: longShotMix(week),
  };
}
