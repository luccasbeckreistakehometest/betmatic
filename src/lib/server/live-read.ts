import { getDb, newId, nowIso } from "@/lib/server/db";
import { findPrediction, savePrediction } from "@/lib/server/predictions";
import { getLiveSnapshot, liveTracker } from "@/lib/server/live";
import { buildBets } from "@/lib/bets/builder";
import { AiBudgetExceededError, brasiliaDayStart } from "@/lib/server/ai-budget";
import { reportError } from "@/lib/server/ops-log";
import { aiConfigured, LIVE_MODEL } from "@/lib/ai/client";
import { espnDateKey, getGameDetail } from "@/lib/sources/espn";
import type { LiveState } from "@/lib/live/state";
import type { LiveSnapshot } from "@/lib/live/snapshot";
import type { BetSlate } from "@/lib/types";
import type { PublicUser } from "@/lib/server/users";
import type { Lang } from "@/lib/i18n";

/**
 * "Leitura ao vivo": Pro and Max only, one per game (per language) every 15 minutes whoever asks,
 * LIVE_READS_DAILY_CAP a day in total. Short bands only, never logged to the public ledger, never
 * pushed anywhere — it lives in the panel.
 */
export const LIVE_COOLDOWN_MS = 15 * 60_000;
export const liveReadsCap = (env: Record<string, string | undefined> = process.env) => {
  const v = Number(env.LIVE_READS_DAILY_CAP);
  return env.LIVE_READS_DAILY_CAP !== undefined && env.LIVE_READS_DAILY_CAP.trim() !== "" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 40;
};

export const canReadLive = (user: Pick<PublicUser, "role" | "plan">) => user.role === "admin" || user.plan.id === "pro" || user.plan.id === "max";

export interface StoredLiveRead { slate: BetSlate; generatedAt: string; minute: number }

export function latestLiveRead(sportKey: string, gameId: string, dateKey: string, lang: Lang): StoredLiveRead | null {
  const row = findPrediction({ scope: "live", sportKey, gameId, dateKey, lang });
  if (!row) return null;
  const payload = JSON.parse(row.payload) as BetSlate & { minute?: number };
  return { slate: { suggestions: payload.suggestions, dataNote: payload.dataNote }, generatedAt: row.generatedAt, minute: payload.minute ?? 0 };
}

const readsToday = () => (getDb().prepare("SELECT COUNT(*) n FROM generation_requests WHERE scope='live' AND createdAt > ?").get(brasiliaDayStart()) as { n: number }).n;
const inflight = new Map<string, Promise<LiveReadResult>>();

export type LiveReadResult =
  | { status: "ok"; read: StoredLiveRead; cached: boolean }
  | { status: "not_allowed" | "not_live" | "cap" | "ai_off" | "ai_budget" | "error" };

function soccerState(s: LiveSnapshot): LiveState {
  const cards = (x: Record<string, number>) => (x.YC ?? 0) + (x.RC ?? 0);
  return { minute: Math.round(s.minute), homeGoals: s.home.score, awayGoals: s.away.score, homeCards: cards(s.home.stats), awayCards: cards(s.away.stats), homeFouls: s.home.stats.FC ?? 0, awayFouls: s.away.stats.FC ?? 0 };
}

export async function runLiveRead(user: PublicUser, sportKey: string, gameId: string, lang: Lang): Promise<LiveReadResult> {
  if (!canReadLive(user)) return { status: "not_allowed" };
  const detail = await getGameDetail(gameId, false, sportKey).catch(() => null);
  const snap = await getLiveSnapshot(sportKey, gameId);
  if (!detail || !snap || snap.state !== "in") return { status: "not_live" };
  const dateKey = espnDateKey(new Date(detail.game.startsAt));
  const existing = latestLiveRead(sportKey, gameId, dateKey, lang);
  if (existing && Date.now() - Date.parse(existing.generatedAt) < LIVE_COOLDOWN_MS) return { status: "ok", read: existing, cached: true };
  const key = `${sportKey}:${gameId}:${lang}`;
  const running = inflight.get(key);
  if (running) return running.then((r) => (r.status === "ok" ? { ...r, cached: true } : r));
  if (user.role !== "admin" && readsToday() >= liveReadsCap()) return { status: "cap" };
  if (!aiConfigured()) return { status: "ai_off" };

  const task = (async (): Promise<LiveReadResult> => {
    const reqId = newId("gr");
    getDb().prepare("INSERT INTO generation_requests (id,userId,sportKey,gameId,dateKey,status,createdAt,scope) VALUES (?,?,?,?,?,?,?,?)")
      .run(reqId, user.id, sportKey, gameId, dateKey, "running", nowIso(), "live");
    try {
      const tracked = await liveTracker(user, sportKey, gameId, dateKey, lang);
      const trackerText = tracked.tickets.slice(0, 4).map((t) => `- ${t.title}: ${t.legs.map((l) => `${l.selection} → ${l.state}${l.probability !== null ? ` ${Math.round(l.probability * 100)}%` : ""} (${l.reason})`).join("; ")}`).join("\n");
      const leaders = snap.players.filter((p) => (p.stats.PTS ?? p.stats.SHOT ?? 0) > 0).slice(0, 10)
        .map((p) => `${p.name} (${p.team}): ${Object.entries(p.stats).filter(([k]) => ["MIN", "PTS", "REB", "AST", "PF", "SHOT", "SOG", "FC", "YC"].includes(k)).map(([k, v]) => `${k} ${v}`).join(", ")}`).join("\n");
      const extraContext = [
        snap.sportGroup === "basketball"
          ? `LIVE — period ${snap.period}, clock ${snap.clock}, ${Math.round(snap.regulationMinutes - snap.minute)} regulation minutes left, score ${snap.away.abbr} ${snap.away.score} @ ${snap.home.abbr} ${snap.home.score}. The pre-match lines below are stale: reason about what is left of the game.`
          : "",
        leaders ? `LIVE PLAYER LINES:\n${leaders}` : "",
        trackerText ? `PRE-MATCH TICKETS, TRACKED NOW:\n${trackerText}` : "",
        "Never urge the reader to bet now; describe what changed and what it means. Live prices move on every play.",
      ].filter(Boolean).join("\n\n");
      const slate = await buildBets({
        game: detail.game, detail, props: [], picks: [], dimers: [], x: null, bands: ["safe", "value"], maxPerBand: 1, lang, record: false, model: LIVE_MODEL,
        live: snap.sportGroup === "soccer" ? soccerState(snap) : null, extraContext,
      });
      savePrediction({ scope: "live", sportKey, gameId, dateKey, lang, matchup: `${detail.game.away.displayName} @ ${detail.game.home.displayName}`, startsAt: detail.game.startsAt, slate: { ...slate, minute: Math.round(snap.minute) } as BetSlate });
      getDb().prepare("UPDATE generation_requests SET status='ok', finishedAt=? WHERE id=?").run(nowIso(), reqId);
      return { status: "ok", read: latestLiveRead(sportKey, gameId, dateKey, lang)!, cached: false };
    } catch (error) {
      getDb().prepare("DELETE FROM generation_requests WHERE id=?").run(reqId);
      reportError("ai.live_read", error, { gameId });
      return { status: error instanceof AiBudgetExceededError ? "ai_budget" : "error" };
    }
  })();
  inflight.set(key, task);
  try { return await task; } finally { inflight.delete(key); }
}
