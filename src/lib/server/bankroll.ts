import { getDb, newId, nowIso } from "@/lib/server/db";
import { readLedger } from "@/lib/ledger/store";
import { ticketSlug } from "@/lib/ledger/proof";
import type { LedgerEntry, LegOutcome } from "@/lib/types";

export interface BankrollRow {
  id: string; userId: string; source: "ticket" | "manual"; ledgerId: string | null; title: string; matchup: string;
  combinedDecimal: number; stake: number; outcome: LegOutcome; createdAt: string; settledAt: string | null;
}
export interface BankrollView extends Omit<BankrollRow, "userId"> { pnl: number; legs?: LedgerEntry["legs"]; /** Public permalink id for ticket entries. */ slug: string | null }

const pnlOf = (outcome: LegOutcome, stake: number, odds: number) => (outcome === "won" ? stake * (odds - 1) : outcome === "lost" ? -stake : 0);

/** Ticket entries take their outcome from the ledger every time they are read — never copied. */
export function listBankroll(userId: string): { entries: BankrollView[]; totals: { staked: number; profit: number; roi: number; won: number; lost: number; pending: number } } {
  const rows = getDb().prepare("SELECT * FROM bankroll_entries WHERE userId=? ORDER BY createdAt DESC").all(userId) as BankrollRow[];
  const ledger = new Map(readLedger().map((e) => [e.id, e]));
  const entries: BankrollView[] = rows.map((r) => {
    const l = r.ledgerId ? ledger.get(r.ledgerId) : undefined;
    const outcome = r.source === "ticket" && l ? l.outcome : r.outcome;
    const { userId: _u, ...rest } = r; void _u;
    return { ...rest, outcome, settledAt: l?.settledAt ?? r.settledAt, pnl: pnlOf(outcome, r.stake, r.combinedDecimal), legs: l?.legs, slug: r.ledgerId ? ticketSlug(r.ledgerId) : null };
  });
  const decided = entries.filter((e) => e.outcome === "won" || e.outcome === "lost");
  const staked = decided.reduce((a, e) => a + e.stake, 0), profit = decided.reduce((a, e) => a + e.pnl, 0);
  return { entries, totals: { staked, profit, roi: staked ? profit / staked : 0, won: decided.filter((e) => e.outcome === "won").length, lost: decided.filter((e) => e.outcome === "lost").length, pending: entries.filter((e) => e.outcome === "pending").length } };
}

/** The ledger id is reconstructed from what the browser knows, then verified to exist. */
export function addTicket(userId: string, input: { gameId: string; bandKey: string; selections: string[]; stake: number }): BankrollView | null {
  const id = `${input.gameId}:${input.bandKey}:${input.selections.join("|")}`;
  const entry = readLedger().find((e) => e.id === id);
  if (!entry) return null;
  const rowId = newId("bk");
  getDb().prepare("INSERT INTO bankroll_entries (id,userId,source,ledgerId,title,matchup,combinedDecimal,stake,createdAt) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(rowId, userId, "ticket", id, entry.title, entry.matchup, entry.combinedDecimal, input.stake, nowIso());
  return listBankroll(userId).entries.find((e) => e.id === rowId) ?? null;
}

export function addManual(userId: string, input: { title: string; odds: number; stake: number }): BankrollView | null {
  const rowId = newId("bk");
  getDb().prepare("INSERT INTO bankroll_entries (id,userId,source,ledgerId,title,matchup,combinedDecimal,stake,createdAt) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(rowId, userId, "manual", null, input.title, "", input.odds, input.stake, nowIso());
  return listBankroll(userId).entries.find((e) => e.id === rowId) ?? null;
}

export function gradeManual(userId: string, id: string, outcome: "won" | "lost" | "void"): boolean {
  const r = getDb().prepare("UPDATE bankroll_entries SET outcome=?, settledAt=? WHERE id=? AND userId=? AND source='manual'").run(outcome, nowIso(), id, userId);
  return r.changes > 0;
}

export function removeEntry(userId: string, id: string): boolean {
  return getDb().prepare("DELETE FROM bankroll_entries WHERE id=? AND userId=?").run(id, userId).changes > 0;
}

/** Whether this user saved the ticket to their bankroll — the gate for "why did it lose?". */
export function userHasTicket(userId: string, ledgerId: string): boolean {
  return !!getDb().prepare("SELECT 1 FROM bankroll_entries WHERE userId=? AND ledgerId=? LIMIT 1").get(userId, ledgerId);
}
