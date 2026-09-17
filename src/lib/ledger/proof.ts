import { createHash } from "node:crypto";
import type { LedgerEntry } from "@/lib/types";

/**
 * The public track record. Every ticket the product ever generated is in the ledger and is graded
 * automatically; this turns that into the numbers a sceptical bettor asks for first — how many, how
 * many hit, and what a flat one-unit stake on all of them would have returned. Nothing is curated.
 */
export interface ProofStats {
  generated: number; settled: number; won: number; lost: number; push: number; void: number; pending: number;
  hitRate: number; unitsStaked: number; unitsReturned: number; roi: number;
  byMarket: { key: string; settled: number; won: number; roi: number }[];
  bySport: { key: string; settled: number; won: number; roi: number }[];
  byBand: { key: string; settled: number; won: number; roi: number }[];
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

export function proofStats(entries: LedgerEntry[]): ProofStats {
  const d = entries.filter(decided);
  const won = d.filter((e) => e.outcome === "won").length;
  const pnl = d.reduce((a, e) => a + unitResult(e), 0);
  return {
    generated: entries.length, settled: entries.filter((e) => e.outcome !== "pending").length,
    won, lost: d.length - won,
    push: entries.filter((e) => e.outcome === "push").length, void: entries.filter((e) => e.outcome === "void").length,
    pending: entries.filter((e) => e.outcome === "pending").length,
    hitRate: d.length ? won / d.length : 0, unitsStaked: d.length, unitsReturned: d.length + pnl, roi: d.length ? pnl / d.length : 0,
    byMarket: slice(entries, (e) => (e.kind === "single" ? e.legs[0]?.market ?? "other" : "parlay")),
    bySport: slice(entries, (e) => e.sportKey),
    byBand: slice(entries, (e) => e.bandKey),
  };
}

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
