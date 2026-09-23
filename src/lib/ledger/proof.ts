import { createHash } from "node:crypto";
import { liveCalibration, type LiveCalibration } from "@/lib/ledger/live-calibration";
import { brasiliaDay } from "@/lib/ledger/day";
import type { LedgerEntry } from "@/lib/types";

export { brasiliaDay };

/**
 * The public track record. Every ticket the product ever generated is in the ledger and is graded
 * automatically; this turns that into the numbers a sceptical bettor asks for first — how many, how
 * many hit, and what a flat one-unit stake on all of them would have returned. Nothing is curated.
 *
 * The money is PRE-GAME ONLY. A live read is priced off the pre-game board, a price no book is
 * still offering by the third quarter, so a unit staked on one is a unit staked at a price that did
 * not exist: on 22/09/2026 the pre-game tickets lost 13.98u and the live reads "won" 177.23u, which
 * is to say 109% of the day's profit came from a price nobody could have taken. Live reads are
 * counted, graded and measured — `liveCalibration` says how often they land against the chance they
 * themselves gave — and they never touch a unit, a return or an ROI.
 */
export interface ProofStats {
  generated: number; settled: number; won: number; lost: number; push: number; void: number; pending: number;
  hitRate: number; unitsStaked: number; unitsReturned: number; roi: number;
  byMarket: { key: string; settled: number; won: number; roi: number }[];
  bySport: { key: string; settled: number; won: number; roi: number }[];
  byBand: { key: string; settled: number; won: number; roi: number }[];
  /** Pre-game tickets against live reads: both count, and the reader can see which carried what. */
  byScope: { key: "pregame" | "live"; settled: number; won: number; roi?: number }[];
  /** The balance per Brasília day, newest first: what a flat unit on every decided PRE-GAME ticket did that day. */
  byDay: DayBalance[];
  /** The live reads measured against their own chances. Never money. */
  liveCalibration: LiveCalibration;
}

export interface DayBalance {
  /** YYYY-MM-DD in America/Sao_Paulo, the day the tickets were decided (or, pending, their kickoff). */
  day: string;
  generated: number; settled: number; won: number; lost: number; pending: number;
  /** Pre-game only: a live read has no collectable price, so it has no units. */
  unitsStaked: number; unitsReturned: number; roi: number;
  live: { settled: number; won: number; predictedAverage: number; expectedWins: number; gapPoints: number };
}

export function dayBalances(entries: LedgerEntry[]): DayBalance[] {
  const days = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    const day = brasiliaDay(decided(e) || e.outcome !== "pending" ? e.settledAt ?? e.startsAt ?? e.createdAt : e.startsAt ?? e.createdAt);
    if (!day) continue;
    days.set(day, [...(days.get(day) ?? []), e]);
  }
  return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, rows]) => {
    const d = rows.filter(decided);
    const won = d.filter((e) => e.outcome === "won");
    // The balance is pre-game money. The live column beside it is a hit rate against a promise.
    const money = d.filter((e) => e.scope !== "live");
    const pnl = money.reduce((a, e) => a + unitResult(e), 0);
    const live = liveCalibration(rows).tickets;
    return {
      day, generated: rows.length, settled: rows.filter((e) => e.outcome !== "pending").length, won: won.length, lost: d.length - won.length,
      pending: rows.filter((e) => e.outcome === "pending").length,
      unitsStaked: money.length, unitsReturned: money.length + pnl, roi: money.length ? pnl / money.length : 0,
      live: { settled: live.n, won: live.won, predictedAverage: live.predictedAverage, expectedWins: live.expectedWins, gapPoints: live.gapPoints },
    };
  });
}

const unitResult = (e: LedgerEntry) => (e.outcome === "won" ? e.combinedDecimal - 1 : e.outcome === "lost" ? -1 : 0);
const decided = (e: LedgerEntry) => e.outcome === "won" || e.outcome === "lost";

function slice(entries: LedgerEntry[], keyOf: (e: LedgerEntry) => string) {
  const m = new Map<string, { settled: number; won: number; pnl: number }>();
  for (const e of entries.filter(decided)) {
    const k = keyOf(e); const b = m.get(k) ?? { settled: 0, won: 0, pnl: 0 };
    b.settled += 1; if (e.outcome === "won") b.won += 1; b.pnl += unitResult(e); m.set(k, b);
  }
  return [...m.entries()].map(([key, b]) => ({ key, settled: b.settled, won: b.won, roi: b.pnl / b.settled })).sort((a, b) => b.settled - a.settled);
}

/**
 * Pre-game against live. The pre-game line carries its ROI; the live one carries counts and no ROI
 * at all, because there is no price behind it to compute one from.
 */
function scopeSlice(entries: LedgerEntry[]) {
  const m = new Map<string, { settled: number; won: number; pnl: number }>();
  for (const e of entries.filter(decided)) {
    const k = e.scope === "live" ? "live" : "pregame";
    const b = m.get(k) ?? { settled: 0, won: 0, pnl: 0 };
    b.settled += 1; if (e.outcome === "won") b.won += 1; b.pnl += unitResult(e); m.set(k, b);
  }
  return [...m.entries()]
    .map(([key, b]) => (key === "live" ? { key, settled: b.settled, won: b.won } : { key, settled: b.settled, won: b.won, roi: b.pnl / b.settled }))
    .sort((a, b) => b.settled - a.settled);
}

export function proofStats(entries: LedgerEntry[]): ProofStats {
  // Money is pre-game. Live reads keep their counts and their calibration, and nothing else.
  const money = entries.filter((e) => e.scope !== "live");
  const d = money.filter(decided);
  const won = d.filter((e) => e.outcome === "won").length;
  const pnl = d.reduce((a, e) => a + unitResult(e), 0);
  return {
    generated: entries.length, settled: entries.filter((e) => e.outcome !== "pending").length,
    won, lost: d.length - won,
    push: entries.filter((e) => e.outcome === "push").length, void: entries.filter((e) => e.outcome === "void").length,
    pending: entries.filter((e) => e.outcome === "pending").length,
    hitRate: d.length ? won / d.length : 0, unitsStaked: d.length, unitsReturned: d.length + pnl, roi: d.length ? pnl / d.length : 0,
    byMarket: slice(money, (e) => (e.kind === "single" ? e.legs[0]?.market ?? "other" : "parlay")),
    bySport: slice(money, (e) => e.sportKey),
    byBand: slice(money, (e) => e.bandKey),
    byScope: scopeSlice(entries) as ProofStats["byScope"],
    byDay: dayBalances(entries),
    liveCalibration: liveCalibration(entries),
  };
}

/**
 * Whether a ticket's content (title, legs, permalink) may be shown to someone who has not paid for
 * it. A ticket is the product until its game starts: before kickoff only the operator sees it.
 * Tickets logged before kickoff times were recorded go public once they are graded.
 */
export function isPublicTicket(e: Pick<LedgerEntry, "outcome" | "startsAt">, now = Date.now()): boolean {
  if (e.startsAt) {
    const kickoff = Date.parse(e.startsAt);
    return Number.isFinite(kickoff) ? kickoff <= now : e.outcome !== "pending";
  }
  return e.outcome !== "pending";
}

/** The record counts main tickets; alternatives are an opt-in view so they never inflate volume. */
export const mainTickets = <T extends Pick<LedgerEntry, "alternativeOf">>(entries: T[], includeAlternatives = false): T[] =>
  includeAlternatives ? entries : entries.filter((e) => !e.alternativeOf);

export const publicTickets = <T extends Pick<LedgerEntry, "outcome" | "startsAt">>(entries: T[], now = Date.now()): T[] =>
  entries.filter((e) => isPublicTicket(e, now));

/** Ledger ids carry ':' and '|'; the public link uses a short stable hash instead. */
export const ticketSlug = (id: string) => createHash("sha1").update(id).digest("hex").slice(0, 10);
export const findBySlug = (entries: LedgerEntry[], slug: string) => entries.find((e) => ticketSlug(e.id) === slug) ?? null;

/** Newest settled first, then pending. */
export function recentTickets(entries: LedgerEntry[], limit = 30): LedgerEntry[] {
  const settled = entries.filter((e) => e.outcome !== "pending").sort((a, b) => (b.settledAt ?? "").localeCompare(a.settledAt ?? ""));
  const pending = entries.filter((e) => e.outcome === "pending").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return [...settled, ...pending].slice(0, limit);
}

/**
 * Aggregate numbers (hit rate, ROI, counts) are published only once enough tickets are decided:
 * three wins in a row is noise, and "0 tickets" is not a pitch. Below the bar the pages explain the
 * method instead. PROOF_MIN_DECIDED overrides the bar (tests use 1).
 */
export function proofMinDecided(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.PROOF_MIN_DECIDED);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30;
}

export function proofPublishable(stats: Pick<ProofStats, "won" | "lost">, env: Record<string, string | undefined> = process.env): boolean {
  return stats.won + stats.lost >= proofMinDecided(env);
}
