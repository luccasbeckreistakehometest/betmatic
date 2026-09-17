import { getDb, newId, nowIso } from "@/lib/server/db";
import { findPrediction } from "@/lib/server/predictions";
import { generateGame } from "@/lib/server/generate-game";
import { refreshCaps, refreshVerdict, type RefreshVerdict } from "@/lib/server/on-demand-policy";
import { refreshConfig } from "@/lib/server/refresh-policy";
import { AiBudgetExceededError, brasiliaDayStart } from "@/lib/server/ai-budget";
import { reportError } from "@/lib/server/ops-log";
import { aiConfigured } from "@/lib/ai/client";
import { espnDateKey, getGameDetail } from "@/lib/sources/espn";
import { getPropPrices, type PostedProp } from "@/lib/sources/espn-props";
import { americanToDecimal } from "@/lib/odds";
import { SPORTS } from "@/lib/sports";
import type { BetLeg, BetSlate } from "@/lib/types";
import type { Lang } from "@/lib/i18n";
import type { PublicUser } from "@/lib/server/users";

export interface CurrentLines {
  props: Pick<PostedProp, "athleteId" | "marketKey" | "side" | "line" | "decimal">[];
  /** Decimal moneylines by team abbreviation. */
  moneyline: Record<string, number>;
  total: number | null;
}

/** Ten cents, with room for floating-point noise (1.97 − 1.87 is 0.0999…). */
const TEN_CENTS = 0.1 - 1e-9;

/**
 * Whether the market moved under a stored ticket: a player line moved or its price changed by 10
 * cents or more, a moneyline changed by 10 cents or more, or the game total moved half a point.
 */
export function linesMoved(legs: Pick<BetLeg, "athleteId" | "oddsDecimal" | "settlement">[], now: CurrentLines): boolean {
  for (const leg of legs) {
    const s = leg.settlement;
    if (!s) continue;
    if (s.type === "player_prop" && leg.athleteId && s.stat && s.line !== undefined) {
      const same = now.props.filter((p) => p.athleteId === leg.athleteId && p.marketKey === s.stat && p.side === s.side);
      if (!same.length) continue;
      const atLine = same.find((p) => p.line === s.line);
      if (!atLine) return true;
      if (Number.isFinite(leg.oddsDecimal) && Math.abs(atLine.decimal - leg.oddsDecimal) >= TEN_CENTS) return true;
    }
    if (s.type === "moneyline" && s.teamAbbreviation) {
      const current = now.moneyline[s.teamAbbreviation];
      if (Number.isFinite(current) && Number.isFinite(leg.oddsDecimal) && Math.abs(current - leg.oddsDecimal) >= TEN_CENTS) return true;
    }
    if (s.type === "total" && !s.teamAbbreviation && s.line !== undefined && now.total !== null && Math.abs(now.total - s.line) >= 0.5) return true;
  }
  return false;
}

const since = () => brasiliaDayStart();
const counts = (userId: string) => {
  const db = getDb();
  return {
    user: (db.prepare("SELECT COUNT(*) n FROM generation_requests WHERE scope='refresh' AND userId=? AND createdAt > ?").get(userId, since()) as { n: number }).n,
    global: (db.prepare("SELECT COUNT(*) n FROM generation_requests WHERE scope='refresh' AND createdAt > ?").get(since()) as { n: number }).n,
  };
};

export interface RefreshState { verdict: RefreshVerdict; reason: "lineup" | "lines" | null; used: number; perUser: number }

/** What the game page shows a Max user: whether "atualizar os bilhetes" is on offer, and why. */
export async function refreshState(user: PublicUser, sportKey: string, gameId: string): Promise<RefreshState> {
  const caps = refreshCaps(process.env);
  const c = counts(user.id);
  const base = { used: c.user, perUser: caps.perUser };
  const isMax = user.role === "admin" || user.plan.id === "max";
  if (!isMax) return { verdict: "not_max", reason: null, ...base };
  const detail = await getGameDetail(gameId, false, sportKey).catch(() => null);
  if (!detail) return { verdict: "no_tickets", reason: null, ...base };
  const dateKey = espnDateKey(new Date(detail.game.startsAt));
  const lang = refreshConfig(process.env, SPORTS.map((s) => s.key)).langs[0];
  const stored = findPrediction({ scope: "game", sportKey, gameId, dateKey, lang });
  const started = Date.parse(detail.game.startsAt) <= Date.now() || detail.game.status !== "scheduled";
  const lineupAlert = stored
    ? !!getDb().prepare("SELECT 1 FROM leg_alerts WHERE gameId=? AND detectedAt > ?").get(gameId, stored.generatedAt)
    : false;
  const hours = stored ? (Date.now() - Date.parse(stored.generatedAt)) / 3_600_000 : 0;
  let moved = false;
  if (stored && !lineupAlert && hours >= 6) {
    const slate = JSON.parse(stored.payload) as BetSlate;
    const book = detail.books[0];
    const feed = await getPropPrices(sportKey, gameId).catch(() => null);
    moved = linesMoved(slate.suggestions.flatMap((s) => s.legs), {
      props: feed?.props ?? [],
      moneyline: {
        [detail.game.home.abbreviation]: americanToDecimal(book?.homeMoneyline ?? NaN),
        [detail.game.away.abbreviation]: americanToDecimal(book?.awayMoneyline ?? NaN),
      },
      total: book?.overUnder ?? null,
    });
  }
  const verdict = refreshVerdict({
    isMax, exists: !!stored, started, lineupAlert, hoursSinceGeneration: hours, linesMoved: moved,
    userCountToday: user.role === "admin" ? 0 : c.user, globalCountToday: c.global, caps,
  });
  return { verdict, reason: lineupAlert ? "lineup" : moved ? "lines" : null, ...base };
}

/** Runs the refresh: the stored tickets are replaced, the ledger keeps the old ones (append-only). */
export async function runPriorityRefresh(user: PublicUser, sportKey: string, gameId: string): Promise<{ status: RefreshVerdict | "refreshed" | "ai_off" | "ai_budget" | "error" }> {
  const state = await refreshState(user, sportKey, gameId);
  if (state.verdict !== "available") return { status: state.verdict };
  if (!aiConfigured()) return { status: "ai_off" };
  const detail = await getGameDetail(gameId, true, sportKey).catch(() => null);
  if (!detail) return { status: "no_tickets" };
  const dateKey = espnDateKey(new Date(detail.game.startsAt));
  const reqId = newId("gr");
  getDb().prepare("INSERT INTO generation_requests (id,userId,sportKey,gameId,dateKey,status,createdAt,scope,note) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(reqId, user.id, sportKey, gameId, dateKey, "running", nowIso(), "refresh", state.reason ?? "");
  try {
    const langs = refreshConfig(process.env, SPORTS.map((s) => s.key)).langs as Lang[];
    const out = await generateGame({ sportKey, dateKey, detail, langs });
    getDb().prepare("UPDATE generation_requests SET status='ok', costUsd=?, finishedAt=? WHERE id=?").run(out.costUsd, nowIso(), reqId);
    return { status: "refreshed" };
  } catch (error) {
    reportError("ai.refresh", error, { sportKey, gameId });
    getDb().prepare("DELETE FROM generation_requests WHERE id=?").run(reqId);
    return { status: error instanceof AiBudgetExceededError ? "ai_budget" : "error" };
  }
}
