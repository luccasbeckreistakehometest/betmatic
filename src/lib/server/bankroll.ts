import { getDb, newId, nowIso } from "@/lib/server/db";
import { readLedger } from "@/lib/ledger/store";
import { ticketSlug } from "@/lib/ledger/proof";
import { gradeLegAgainst, ticketOutcome } from "@/lib/ledger/settle";
import { getGameDetail } from "@/lib/sources/espn";
import { alertsForEntries } from "@/lib/server/lineups";
import { clvByLedger, recordLegPrices } from "@/lib/server/leg-prices";
import type { BetLeg, LedgerEntry, LegOutcome, Settlement, SettledLeg } from "@/lib/types";

export interface BankrollRow {
  id: string; userId: string; source: "ticket" | "manual" | "custom" | "scan"; ledgerId: string | null; title: string; matchup: string;
  combinedDecimal: number; stake: number; outcome: LegOutcome; createdAt: string; settledAt: string | null;
}
export interface BankrollView extends Omit<BankrollRow, "userId"> {
  pnl: number;
  legs?: LedgerEntry["legs"];
  /** Public permalink id for ticket entries. */
  slug: string | null;
  /** Legs of a custom/scanned entry that the server grades by itself. */
  autoLegs?: number;
  /** Mean closing line value of the entry's legs that have a close. */
  clv?: { pct: number; n: number; moved: number };
  /** Lineup watcher: legs of this entry that lost their player before kickoff. */
  alerts?: { kind: string; player: string }[];
}

interface LegRow { entryId: string; idx: number; selection: string; market: string; odds: number | null; gameId: string | null; sportKey: string | null; startsAt: string | null; settlement: string | null; outcome: LegOutcome; actual: string }

export interface NewLeg { selection: string; market: string; odds: number | null; gameId: string | null; sportKey: string | null; startsAt?: string | null; athleteId?: string | null; settlement: Settlement | null }

const legView = (r: LegRow): SettledLeg => ({
  selection: r.selection, market: r.market, sourceBasis: r.settlement ? "auto" : "manual",
  settlement: r.settlement ? (JSON.parse(r.settlement) as Settlement) : undefined,
  predictedProbability: 0, oddsDecimal: r.odds ?? NaN, outcome: r.outcome, actual: r.actual || undefined,
});

const pnlOf = (outcome: LegOutcome, stake: number, odds: number) => (outcome === "won" ? stake * (odds - 1) : outcome === "lost" ? -stake : 0);

/** Ticket entries take their outcome from the ledger every time they are read — never copied. */
export function listBankroll(userId: string): { entries: BankrollView[]; totals: { staked: number; profit: number; roi: number; won: number; lost: number; pending: number } } {
  const rows = getDb().prepare("SELECT * FROM bankroll_entries WHERE userId=? ORDER BY createdAt DESC").all(userId) as BankrollRow[];
  const ledger = new Map(readLedger().map((e) => [e.id, e]));
  const legRows = getDb().prepare("SELECT l.* FROM bankroll_legs l JOIN bankroll_entries e ON e.id = l.entryId WHERE e.userId=? ORDER BY l.entryId, l.idx").all(userId) as LegRow[];
  const byEntry = new Map<string, LegRow[]>();
  for (const r of legRows) byEntry.set(r.entryId, [...(byEntry.get(r.entryId) ?? []), r]);
  const alerts = alertsForEntries(rows.filter((r) => r.outcome === "pending" || r.source === "ticket"));
  const clv = clvByLedger(rows.flatMap((r) => (r.ledgerId ? [r.ledgerId, `bl:${r.id}`] : [`bl:${r.id}`])));
  const entries: BankrollView[] = rows.map((r) => {
    const l = r.ledgerId ? ledger.get(r.ledgerId) : undefined;
    const outcome = r.source === "ticket" && l ? l.outcome : r.outcome;
    const own = byEntry.get(r.id);
    const { userId: _u, ...rest } = r; void _u;
    return {
      ...rest, outcome, settledAt: l?.settledAt ?? r.settledAt, pnl: pnlOf(outcome, r.stake, r.combinedDecimal),
      legs: l?.legs ?? own?.map(legView), slug: r.ledgerId ? ticketSlug(r.ledgerId) : null,
      autoLegs: own ? own.filter((x) => x.settlement).length : undefined,
      alerts: outcome === "pending" ? alerts.get(r.id) : undefined,
      clv: clv.get(r.ledgerId ?? "") ?? clv.get(`bl:${r.id}`),
    };
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

/**
 * A ticket logged from the day's short list. Unlike `addTicket` the id is given, not rebuilt from
 * its parts: a live read's ledger id carries the minute it was taken at, which no browser can
 * reconstruct. The recommended price is stored beside the price the reader says they got, and the
 * legs are priced into `leg_prices` so the entry has a close to be measured against.
 */
export function addTicketById(userId: string, input: {
  ledgerId: string; stake: number; title: string; matchup: string;
  recommendedDecimal: number; confirmedDecimal: number | null;
  gameId: string; sportKey: string; startsAt: string | null; legs: BetLeg[];
}): BankrollView | null {
  const decimal = input.confirmedDecimal ?? input.recommendedDecimal;
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  const rowId = newId("bk");
  const db = getDb();
  const known = !!readLedger().find((e) => e.id === input.ledgerId);
  db.prepare(`INSERT INTO bankroll_entries (id,userId,source,ledgerId,title,matchup,combinedDecimal,stake,createdAt,recommendedDecimal,recommendedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(rowId, userId, known ? "ticket" : "manual", known ? input.ledgerId : null, input.title.slice(0, 160), input.matchup.slice(0, 160), decimal, input.stake, nowIso(), input.recommendedDecimal, nowIso());
  // CLV needs the price this bet was taken at; a leg the descriptor cannot name is simply skipped.
  recordLegPrices(input.legs.slice(0, 20).map((l, i) => ({
    ledgerId: known ? input.ledgerId : `bl:${rowId}`, legIndex: i, gameId: input.gameId, sportKey: input.sportKey,
    startsAt: input.startsAt, homeAbbr: null, leg: l,
  })));
  return listBankroll(userId).entries.find((e) => e.id === rowId) ?? null;
}

export function addManual(userId: string, input: { title: string; odds: number; stake: number }): BankrollView | null {
  const rowId = newId("bk");
  getDb().prepare("INSERT INTO bankroll_entries (id,userId,source,ledgerId,title,matchup,combinedDecimal,stake,createdAt) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(rowId, userId, "manual", null, input.title, "", input.odds, input.stake, nowIso());
  return listBankroll(userId).entries.find((e) => e.id === rowId) ?? null;
}

export function gradeManual(userId: string, id: string, outcome: "won" | "lost" | "void"): boolean {
  const r = getDb().prepare("UPDATE bankroll_entries SET outcome=?, settledAt=? WHERE id=? AND userId=? AND source IN ('manual','custom','scan')").run(outcome, nowIso(), id, userId);
  return r.changes > 0;
}

export function removeEntry(userId: string, id: string): boolean {
  return getDb().prepare("DELETE FROM bankroll_entries WHERE id=? AND userId=?").run(id, userId).changes > 0;
}

/** Whether this user saved the ticket to their bankroll — the gate for "why did it lose?". */
export function userHasTicket(userId: string, ledgerId: string): boolean {
  return !!getDb().prepare("SELECT 1 FROM bankroll_entries WHERE userId=? AND ledgerId=? LIMIT 1").get(userId, ledgerId);
}

/** A bet with its own legs (custom parlay, slip print). Written in one transaction. */
export function addWithLegs(userId: string, input: { source: "custom" | "scan"; title: string; matchup: string; odds: number; stake: number; legs: NewLeg[] }): BankrollView | null {
  const db = getDb();
  const rowId = newId("bk");
  db.transaction(() => {
    db.prepare("INSERT INTO bankroll_entries (id,userId,source,ledgerId,title,matchup,combinedDecimal,stake,createdAt) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(rowId, userId, input.source, null, input.title.slice(0, 160), input.matchup.slice(0, 160), input.odds, input.stake, nowIso());
    const insert = db.prepare("INSERT INTO bankroll_legs (entryId,idx,selection,market,odds,gameId,sportKey,startsAt,settlement) VALUES (?,?,?,?,?,?,?,?,?)");
    input.legs.slice(0, 20).forEach((l, i) => insert.run(rowId, i, l.selection.slice(0, 200), l.market.slice(0, 60), l.odds, l.gameId, l.sportKey, l.startsAt ?? null, l.settlement ? JSON.stringify(l.settlement) : null));
  }).immediate();
  // Legs matched to a game also get a price to compare with the close (CLV).
  recordLegPrices(input.legs.slice(0, 20).flatMap((l, i) => (l.gameId && l.sportKey && l.settlement && l.odds
    ? [{ ledgerId: `bl:${rowId}`, legIndex: i, gameId: l.gameId, sportKey: l.sportKey, startsAt: l.startsAt ?? null, homeAbbr: null, leg: { athleteId: l.athleteId ?? undefined, oddsDecimal: l.odds, settlement: l.settlement } }]
    : [])));
  return listBankroll(userId).entries.find((e) => e.id === rowId) ?? null;
}

/**
 * Grades the legs of custom and scanned entries whose game has finished, then settles the entry when
 * every leg is decided (a loss settles it at once). An entry with a leg that cannot be graded stays
 * pending for the user to mark. ESPN only, no tokens.
 */
export async function settleBankrollLegs(limit = 200): Promise<{ legs: number; entries: number }> {
  const db = getDb();
  const pending = db.prepare("SELECT * FROM bankroll_legs WHERE outcome='pending' AND settlement IS NOT NULL AND gameId IS NOT NULL AND (startsAt IS NULL OR startsAt <= ?) LIMIT ?")
    .all(nowIso(), limit) as LegRow[];
  const details = new Map<string, Awaited<ReturnType<typeof getGameDetail>>>();
  const touched = new Set<string>();
  let graded = 0;
  for (const row of pending) {
    const key = `${row.sportKey}:${row.gameId}`;
    if (!details.has(key)) details.set(key, await getGameDetail(row.gameId!, false, row.sportKey ?? undefined).catch(() => null));
    const detail = details.get(key);
    if (!detail || detail.game.status !== "final") continue;
    const out = await gradeLegAgainst(legView(row), detail, row.sportKey ?? detail.game.sportKey);
    if (out.outcome === "pending") continue;
    db.prepare("UPDATE bankroll_legs SET outcome=?, actual=? WHERE entryId=? AND idx=?").run(out.outcome, out.actual ?? "", row.entryId, row.idx);
    touched.add(row.entryId);
    graded += 1;
  }
  let settled = 0;
  for (const entryId of touched) {
    const legs = db.prepare("SELECT outcome, settlement FROM bankroll_legs WHERE entryId=?").all(entryId) as { outcome: LegOutcome; settlement: string | null }[];
    // A leg the server cannot grade keeps the entry for the user, unless another leg already lost.
    const unresolved = legs.some((l) => !l.settlement);
    const outcome = ticketOutcome(legs);
    if (outcome === "pending" || (unresolved && outcome !== "lost")) continue;
    if (db.prepare("UPDATE bankroll_entries SET outcome=?, settledAt=? WHERE id=? AND outcome='pending'").run(outcome, nowIso(), entryId).changes) settled += 1;
  }
  return { legs: graded, entries: settled };
}
