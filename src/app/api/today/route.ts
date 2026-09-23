import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { getSettings, pauseState, stakeVerdict } from "@/lib/server/settings";
import { visibleSuggestionIds } from "@/lib/server/entitlement";
import { addTicketById, userHasTicket } from "@/lib/server/bankroll";
import { buildDailyList, dayInventory, readDailyItems, readDailySelection, type InventoryEntry } from "@/lib/server/daily-list";
import { calibrationHeadline } from "@/lib/ledger/calibration-input";
import { brasiliaDay } from "@/lib/ledger/proof";
import { SIZING, unitsToMoney } from "@/lib/bets/sizing";
import { ladderUnits } from "@/lib/bets/selection";
import { impliedProbability } from "@/lib/odds";
import { normaliseLang, type Lang } from "@/lib/i18n";
import { SOLD_SPORTS } from "@/lib/sports";
import { recordRouteEvent } from "@/lib/server/analytics";
import { reportError } from "@/lib/server/ops-log";
import type { BetSuggestion } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The day's short list for one reader, with their own bankroll applied.
 *
 * It reads the selection the `today` job filed (`daily_selection`) and rebuilds it in memory when
 * the job has not run yet, so the screen is never blank for a scheduling reason. Everything the
 * reader's plan hides on /app is hidden here too: the gate is `visibleSuggestionIds`, the same
 * one the pushes and the live panel use, so a short list is never a side door to paid picks.
 */

export interface TodayLeg { selection: string; market: string; decimal: number; explanation: string; evidence: string; probability: number }

export interface TodayItem {
  ledgerId: string; gameId: string; suggestionId: string; title: string; matchup: string; startsAt: string;
  scope: "pre" | "live"; period?: number; bandKey: string;
  decimal: number; modelProbability: number; calibratedProbability: number; impliedProbability: number;
  units: number; pctOfBankroll: number; money: number | null;
  minDecimal: number; capped: string; ladderUnits: number; expiresAt?: string;
  book: string | null; gameHref: string;
  saved: boolean;
  /** Everything that already exists today and does not disappear — it moves behind "por que este". */
  detail: {
    legs: TodayLeg[]; background: string; riskNote: string; evidenceScore: number; evidenceNotes: string[];
    confidence: string; edgePct: number; correlationNote: string | null; alternatives: number;
  };
}

export interface TodayView {
  day: string; sportKey: string; mode: string; note: string;
  items: TodayItem[]; live: TodayItem[];
  totals: { units: number; pctOfBankroll: number; money: number | null; games: number };
  bankrollAmount: number | null; smallBankroll: boolean;
  generated: number; games: number; bandGated: boolean;
  calibration: { settledLegs: number; gapPoints: number };
}

const EMPTY_TOTALS = { units: 0, pctOfBankroll: 0, money: null, games: 0 };

function detailOf(s: BetSuggestion, alternatives: number): TodayItem["detail"] {
  return {
    legs: s.legs.map((l) => ({ selection: l.selection, market: l.market, decimal: l.oddsDecimal, explanation: l.explanation ?? "", evidence: l.evidence ?? "", probability: l.fairProbability })),
    background: s.background ?? "",
    riskNote: s.riskNote ?? "",
    evidenceScore: s.evidenceScore ?? 0,
    evidenceNotes: s.evidenceNotes ?? [],
    confidence: s.confidence,
    edgePct: s.edgePct,
    correlationNote: s.correlation?.note ?? null,
    alternatives,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lang = normaliseLang(url.searchParams.get("lang"));
  const sportKey = url.searchParams.get("sport") ?? "";
  if (!SOLD_SPORTS.some((s) => s.key === sportKey)) return NextResponse.json({ error: "sport" }, { status: 400 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autorizado" }, { status: 401 });

  try {
    return NextResponse.json(todayView(user, sportKey, lang, url.searchParams.get("day")));
  } catch (error) {
    reportError("today.view", error, { sportKey });
    return NextResponse.json({ error: "today" }, { status: 502 });
  }
}

/** Pure-ish read: no writes, so a page load never races the job. */
export function todayView(
  user: NonNullable<Awaited<ReturnType<typeof currentUser>>>,
  sportKey: string,
  lang: Lang,
  dayParam?: string | null,
  now = Date.now(),
): TodayView {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayParam ?? "") ? dayParam! : brasiliaDay(new Date(now).toISOString());
  const inventory = dayInventory(day, sportKey, lang);
  const byLedgerId = new Map(inventory.map((e) => [e.candidate.ledgerId, e]));
  const alternativesOf = new Map<string, number>();
  for (const e of inventory) {
    const target = e.candidate.alternativeOf;
    if (target) alternativesOf.set(target, (alternativesOf.get(target) ?? 0) + 1);
  }

  const stored = readDailySelection(day, sportKey);
  const rows = stored ? readDailyItems(day, sportKey) : [];
  // No filed answer yet (a fresh day, or the job has not ticked): compute it for the read, write nothing.
  const fallback = stored ? null : buildDailyList(day, sportKey, { now, lang });
  const selected = stored
    ? rows.map((r) => ({ ledgerId: r.ledgerId, scope: r.scope, units: r.units, minDecimal: r.minDecimal ?? NaN, capped: r.capped, calibratedProbability: r.calibratedProbability, expiresAt: r.expiresAt ?? undefined, rank: r.rank }))
    : [...fallback!.selection.items, ...fallback!.selection.live].map((i) => ({
        ledgerId: i.candidate.ledgerId, scope: i.candidate.scope, units: i.units, minDecimal: i.minAcceptableDecimal,
        capped: i.capped, calibratedProbability: i.calibratedProbability, expiresAt: i.expiresAt, rank: i.rank,
      }));

  const settings = getSettings(user.id);
  const bankroll = settings.bankrollAmount && settings.bankrollAmount > 0 ? settings.bankrollAmount : null;
  const visible = new Map<string, Set<string>>();
  const mayRead = (e: InventoryEntry) => {
    if (user.role === "admin") return true;
    const key = `${e.candidate.gameId}:${e.dateKey}`;
    if (!visible.has(key)) visible.set(key, visibleSuggestionIds(user, { sportKey, gameId: e.candidate.gameId, lang, dateKey: e.dateKey, now }));
    return visible.get(key)!.has(e.suggestion.id);
  };

  let bandGated = false;
  const build = (row: (typeof selected)[number]): TodayItem | null => {
    const e = byLedgerId.get(row.ledgerId);
    if (!e) return null;
    if (!mayRead(e)) { bandGated = true; return null; }
    const c = e.candidate;
    return {
      ledgerId: c.ledgerId, gameId: c.gameId, suggestionId: c.suggestionId, title: c.title ?? "", matchup: c.matchup ?? "",
      startsAt: c.startsAt, scope: c.scope, ...(c.period !== undefined ? { period: c.period } : {}), bandKey: c.bandKey,
      decimal: c.decimal, modelProbability: c.modelProbability, calibratedProbability: row.calibratedProbability,
      impliedProbability: impliedProbability(c.decimal),
      units: row.units, pctOfBankroll: row.units * SIZING.unitPct,
      money: bankroll ? unitsToMoney(row.units, bankroll) : null,
      minDecimal: row.minDecimal, capped: row.capped, ladderUnits: ladderUnits(c.decimal),
      ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
      book: e.book, gameHref: `/app/game/${c.gameId}?sport=${sportKey}&lang=${lang}`,
      saved: userHasTicket(user.id, c.ledgerId),
      detail: detailOf(e.suggestion, alternativesOf.get(c.ledgerId) ?? 0),
    };
  };

  const items = selected.filter((r) => r.scope === "pre").map(build).filter((x): x is TodayItem => !!x);
  const live = selected.filter((r) => r.scope === "live").map(build).filter((x): x is TodayItem => !!x);
  const units = items.reduce((a, i) => a + i.units, 0);
  const calibration = calibrationHeadline();

  return {
    day, sportKey,
    mode: stored?.mode ?? fallback!.selection.mode,
    note: stored?.note ?? fallback!.selection.note,
    items, live,
    totals: items.length
      ? { units: Number(units.toFixed(2)), pctOfBankroll: units * SIZING.unitPct, money: bankroll ? unitsToMoney(units, bankroll) : null, games: new Set(items.map((i) => i.gameId)).size }
      : EMPTY_TOTALS,
    bankrollAmount: bankroll,
    // Below R$ 300 the floor stake lands under what a book will accept: say so, do not round up.
    smallBankroll: !!bankroll && bankroll < 300,
    generated: inventory.length,
    games: new Set(inventory.map((e) => e.candidate.gameId)).size,
    bandGated,
    calibration,
  };
}

const schema = z.object({
  ledgerId: z.string().min(3).max(300),
  stake: z.number().positive().max(1_000_000),
  /** The price the reader actually got; a live read only becomes a bet once it is given. */
  confirmedDecimal: z.number().min(1.01).max(10_000).optional(),
  sport: z.string().max(30).optional(),
  day: z.string().max(12).optional(),
  lang: z.enum(["pt", "en"]).optional(),
});

/**
 * "Registrei essa aposta" — and, for a live read, the price that makes it one.
 *
 * The user's own responsible-play rules are enforced here and are never overridden by the policy:
 * a pause locks it, a daily or weekly ceiling caps it. The recommended price is stored beside the
 * one they got, which is what makes the wallet's CLV computable.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });

  const pause = pauseState(user.id);
  if (pause.paused) return NextResponse.json({ error: "paused", pausedUntil: pause.until }, { status: 423 });
  const verdict = stakeVerdict(user.id, parsed.data.stake);
  if (!verdict.allowed) return NextResponse.json({ error: "limit", ...verdict }, { status: 422 });

  const lang = normaliseLang(parsed.data.lang);
  const sportKey = SOLD_SPORTS.some((s) => s.key === parsed.data.sport) ? parsed.data.sport! : "";
  if (!sportKey) return NextResponse.json({ error: "sport" }, { status: 400 });
  const day = /^\d{4}-\d{2}-\d{2}$/.test(parsed.data.day ?? "") ? parsed.data.day! : brasiliaDay(new Date().toISOString());

  const entry = dayInventory(day, sportKey, lang).find((e) => e.candidate.ledgerId === parsed.data.ledgerId);
  if (!entry) return NextResponse.json({ error: "bilhete não encontrado" }, { status: 404 });
  if (user.role !== "admin" && !visibleSuggestionIds(user, { sportKey, gameId: entry.candidate.gameId, lang, dateKey: entry.dateKey }).has(entry.suggestion.id)) {
    return NextResponse.json({ error: "bilhete não encontrado" }, { status: 404 });
  }
  // A live read is a reference price until the reader says what they got: no confirmation, no bet.
  if (entry.candidate.scope === "live" && !parsed.data.confirmedDecimal) {
    return NextResponse.json({ error: "confirme a odd que você pegou" }, { status: 422 });
  }

  const saved = addTicketById(user.id, {
    ledgerId: parsed.data.ledgerId,
    stake: parsed.data.stake,
    title: entry.candidate.title ?? entry.suggestion.title,
    matchup: entry.candidate.matchup ?? "",
    recommendedDecimal: entry.candidate.decimal,
    confirmedDecimal: parsed.data.confirmedDecimal ?? null,
    gameId: entry.candidate.gameId,
    sportKey,
    startsAt: entry.candidate.startsAt,
    legs: entry.suggestion.legs,
  });
  if (!saved) return NextResponse.json({ error: "bilhete não encontrado" }, { status: 404 });
  await recordRouteEvent("today_bet_logged", user.id, { scope: entry.candidate.scope, units: parsed.data.stake });
  return NextResponse.json({ entry: saved });
}
