import { getDb, newId, nowIso } from "@/lib/server/db";
import { clvOf, clvSummary, lineMove, noVigShare, type ClvSummary } from "@/lib/ledger/clv";
import { mainTickets } from "@/lib/ledger/proof";
import { readLedger } from "@/lib/ledger/store";
import { getGameLines, getPropPrices, type LineSnapshot, type PostedProp, type ProviderLines } from "@/lib/sources/espn-props";
import { logEvent, reportError } from "@/lib/server/ops-log";
import { getSport } from "@/lib/sports";
import type { BetLeg, Settlement } from "@/lib/types";

/** What a leg needs to be priced again at the close. Null when the leg is not a market we can re-read. */
export interface PriceKey { kind: "ml" | "total" | "spread" | "prop"; marketKey: string; athleteId: string | null; side: string | null; line: number | null }

export function priceKeyOf(leg: Pick<BetLeg, "athleteId"> & { settlement?: Settlement }, homeAbbr: string | null): PriceKey | null {
  const s = leg.settlement;
  if (!s) return null;
  if (s.type === "player_prop" && leg.athleteId && s.stat && s.line !== undefined && (s.side === "over" || s.side === "under")) {
    return { kind: "prop", marketKey: s.stat, athleteId: leg.athleteId, side: s.side, line: s.line };
  }
  if (s.type === "moneyline" && s.teamAbbreviation) {
    const side = s.side === "home" || s.side === "away" ? s.side : homeAbbr ? (s.teamAbbreviation === homeAbbr ? "home" : "away") : null;
    return side ? { kind: "ml", marketKey: "moneyline", athleteId: null, side, line: null } : null;
  }
  if (s.type === "total" && !s.teamAbbreviation && s.line !== undefined && (s.side === "over" || s.side === "under")) {
    return { kind: "total", marketKey: "total", athleteId: null, side: s.side, line: s.line };
  }
  return null;
}

export interface PricedLegInput { ledgerId: string; legIndex: number; gameId: string; sportKey: string; startsAt: string | null; homeAbbr: string | null; leg: Pick<BetLeg, "athleteId" | "oddsDecimal" | "openOdds"> & { settlement?: Settlement } }

/** Taken and open prices, written once when a ticket is logged (a re-log of the same ticket is ignored). */
export function recordLegPrices(rows: PricedLegInput[]): number {
  const db = getDb();
  const stmt = db.prepare(`INSERT OR IGNORE INTO leg_prices (ledgerId, legIndex, gameId, sportKey, startsAt, kind, marketKey, athleteId, side, line, takenDecimal, openDecimal, createdAt, updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let n = 0;
  db.transaction(() => {
    for (const r of rows) {
      if (!/^\d{1,12}$/.test(r.gameId) || !Number.isFinite(r.leg.oddsDecimal) || r.leg.oddsDecimal <= 1) continue;
      const key = priceKeyOf(r.leg, r.homeAbbr);
      if (!key) continue;
      n += stmt.run(r.ledgerId, r.legIndex, r.gameId, r.sportKey, r.startsAt, key.kind, key.marketKey, key.athleteId, key.side, key.line, r.leg.oddsDecimal, r.leg.openOdds ?? null, nowIso(), nowIso()).changes;
    }
  }).immediate();
  return n;
}

interface Row { ledgerId: string; legIndex: number; gameId: string; sportKey: string; startsAt: string | null; kind: PriceKey["kind"]; marketKey: string; athleteId: string | null; side: string | null; line: number | null; takenDecimal: number }
export interface CloseOutcome { status: "closed" | "line_moved" | "no_close"; close: number | null; fair: number | null; closeLine: number | null; clv: number | null; basis: string | null; direction: string | null }

const NONE: CloseOutcome = { status: "no_close", close: null, fair: null, closeLine: null, clv: null, basis: null, direction: null };

/** The close of one leg from a line snapshot (game lines) or the posted props (player legs). Pure. */
export function closeOf(row: Pick<Row, "kind" | "marketKey" | "athleteId" | "side" | "line" | "takenDecimal">, snap: LineSnapshot | null, props: Pick<PostedProp, "athleteId" | "marketKey" | "side" | "line" | "decimal" | "noVigFair">[], soccer: boolean): CloseOutcome {
  const finish = (close: number | null, prices: (number | null)[], index: number, closeLine: number | null): CloseOutcome => {
    if (close === null || !Number.isFinite(close)) return NONE;
    if (row.line !== null && closeLine !== null && closeLine !== row.line) {
      return { ...NONE, status: "line_moved", closeLine, close, direction: lineMove(row.side ?? undefined, row.line, closeLine) };
    }
    const fair = prices.every((p) => p !== null) ? noVigShare(prices as number[], index) : null;
    const clv = clvOf(row.takenDecimal, close, fair);
    return clv ? { status: "closed", close, fair, closeLine, clv: clv.pct, basis: clv.basis, direction: null } : NONE;
  };
  if (row.kind === "prop") {
    const same = props.filter((p) => p.athleteId === row.athleteId && p.marketKey === row.marketKey && p.side === row.side);
    const exact = same.find((p) => p.line === row.line);
    if (exact) {
      const clv = clvOf(row.takenDecimal, exact.decimal, exact.noVigFair);
      return clv ? { status: "closed", close: exact.decimal, fair: exact.noVigFair, closeLine: exact.line, clv: clv.pct, basis: clv.basis, direction: null } : NONE;
    }
    if (!same.length || row.line === null) return NONE;
    const nearest = [...same].sort((a, b) => Math.abs(a.line - row.line!) - Math.abs(b.line - row.line!))[0];
    return { ...NONE, status: "line_moved", close: nearest.decimal, closeLine: nearest.line, direction: lineMove(row.side ?? undefined, row.line, nearest.line) };
  }
  if (!snap) return NONE;
  if (row.kind === "ml") {
    const prices = soccer ? [snap.homeMl, snap.draw, snap.awayMl] : [snap.homeMl, snap.awayMl];
    const index = row.side === "home" ? 0 : prices.length - 1;
    return finish(row.side === "home" ? snap.homeMl : snap.awayMl, prices, index, null);
  }
  if (row.kind === "total") return finish(row.side === "over" ? snap.over : snap.under, [snap.over, snap.under], row.side === "over" ? 0 : 1, snap.total);
  return NONE;
}

const bookOf = (lines: ProviderLines[]) => lines.find((l) => /draft/i.test(l.provider)) ?? lines.find((l) => l.open || l.current || l.close) ?? null;

/**
 * The close job. Pending legs whose game starts within 15 minutes are priced from the current line
 * (which is the close for our purposes); ones that started up to 30 minutes ago use the book's official
 * close when ESPN has it; anything older without a close is marked no_close. Idempotent.
 */
export async function runCloseJob(opts: { now?: Date } = {}): Promise<{ games: number; closed: number; moved: number; noClose: number }> {
  const now = (opts.now ?? new Date()).getTime();
  const db = getDb();
  const rows = db.prepare("SELECT * FROM leg_prices WHERE status='pending' AND startsAt IS NOT NULL AND startsAt <= ? ORDER BY startsAt LIMIT 400")
    .all(new Date(now + 15 * 60_000).toISOString()) as Row[];
  const byGame = new Map<string, Row[]>();
  for (const r of rows) byGame.set(`${r.sportKey}:${r.gameId}`, [...(byGame.get(`${r.sportKey}:${r.gameId}`) ?? []), r]);
  const out = { games: 0, closed: 0, moved: 0, noClose: 0 };
  const update = db.prepare("UPDATE leg_prices SET status=?, closeDecimal=?, closeFair=?, closeLine=?, clvPct=?, basis=?, direction=?, updatedAt=? WHERE ledgerId=? AND legIndex=? AND status='pending'");
  for (const group of [...byGame.values()].slice(0, 50)) {
    const { sportKey, gameId, startsAt } = group[0];
    const kickoff = Date.parse(startsAt ?? "");
    const started = now >= kickoff;
    const stale = now - kickoff > 30 * 60_000;
    try {
      const lines = await getGameLines(sportKey, gameId, true);
      const book = bookOf(lines);
      const snap = book ? (book.close ?? (started ? null : book.current)) : null;
      const props = !started && group.some((r) => r.kind === "prop") ? (await getPropPrices(sportKey, gameId, true)).props : [];
      out.games += 1;
      for (const r of group) {
        const res = closeOf(r, snap, props, getSport(sportKey).group === "soccer");
        if (res.status === "no_close" && !stale) continue;
        update.run(res.status, res.close, res.fair, res.closeLine, res.clv, res.basis, res.direction, nowIso(), r.ledgerId, r.legIndex);
        if (res.status === "closed") out.closed += 1; else if (res.status === "line_moved") out.moved += 1; else out.noClose += 1;
      }
    } catch (error) {
      reportError("job.close", error, { gameId }, "warn");
    }
  }
  logEvent("job.close", { ...out, runId: newId("job") });
  return out;
}

export interface EntryClv { pct: number; n: number; moved: number }

export function clvByLedger(ids: string[]): Map<string, EntryClv> {
  const out = new Map<string, EntryClv>();
  const stmt = getDb().prepare("SELECT status, clvPct FROM leg_prices WHERE ledgerId=?");
  for (const id of ids) {
    const rows = stmt.all(id) as { status: string; clvPct: number | null }[];
    const closed = rows.filter((r) => r.status === "closed" && r.clvPct !== null) as { clvPct: number }[];
    const moved = rows.filter((r) => r.status === "line_moved").length;
    if (!closed.length && !moved) continue;
    out.set(id, { pct: closed.length ? closed.reduce((a, r) => a + r.clvPct, 0) / closed.length : NaN, n: closed.length, moved });
  }
  return out;
}

const MARKET_LABEL: Record<string, string> = { moneyline: "moneyline", total: "total" };

/** The public CLV block: legs of main tickets (alternatives excluded, like the rest of /prova). */
export function publicClv(minSample?: number): ClvSummary {
  const main = new Set(mainTickets(readLedger()).map((e) => e.id));
  const rows = getDb().prepare("SELECT ledgerId, marketKey, kind, status, clvPct, basis, direction FROM leg_prices WHERE status IN ('closed','line_moved') AND ledgerId NOT LIKE 'bl:%'").all() as
    { ledgerId: string; marketKey: string; kind: string; status: string; clvPct: number | null; basis: "novig" | "raw" | null; direction: string | null }[];
  return clvSummary(rows.filter((r) => main.has(r.ledgerId)).map((r) => ({ market: r.kind === "prop" ? r.marketKey : MARKET_LABEL[r.marketKey] ?? r.marketKey, clvPct: r.clvPct, status: r.status, basis: r.basis, direction: r.direction })), minSample);
}

/** One line for the learning run: where the prices we take beat the close, per market. */
export function clvPromptLine(): string {
  const s = publicClv(10);
  if (!s.publishable) return `CLOSING LINE VALUE: ${s.n} legs with a close so far — too few to read.`;
  return `CLOSING LINE VALUE (${s.n} legs): mean ${(s.mean * 100).toFixed(1)}%, ${(s.beat * 100).toFixed(0)}% beat the close; by market ${s.byMarket.slice(0, 6).map((m) => `${m.market} ${(m.mean * 100).toFixed(1)}% (n=${m.n})`).join(", ")}.`;
}
