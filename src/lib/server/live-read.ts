import { getDb, newId, nowIso } from "@/lib/server/db";
import { findPrediction, savePrediction } from "@/lib/server/predictions";
import { getLiveSnapshot, liveTracker } from "@/lib/server/live";
import { buildBets } from "@/lib/bets/builder";
import { buildPropCandidates } from "@/lib/props/candidates";
import { recordPredictions } from "@/lib/ledger/store";
import { AiBudgetExceededError, brasiliaDayStart } from "@/lib/server/ai-budget";
import { reportError } from "@/lib/server/ops-log";
import { aiConfigured, LIVE_MODEL } from "@/lib/ai/client";
import { espnDateKey, getGameDetail } from "@/lib/sources/espn";
import type { LiveState } from "@/lib/live/state";
import type { LiveSnapshot } from "@/lib/live/snapshot";
import type { BetSlate, PropRow } from "@/lib/types";
import type { PublicUser } from "@/lib/server/users";
import type { Lang } from "@/lib/i18n";

/**
 * "Leitura ao vivo": Pro and Max only, one per game (per language) every 15 minutes whoever asks,
 * LIVE_READS_DAILY_CAP a day in total. Never logged to the public ledger, never pushed anywhere —
 * it lives in the panel.
 *
 * It reaches the long bands, unlike the pre-game read, because half the distribution is already on
 * the board: a line the player is on pace to clear needs the established rate to continue rather
 * than a projection to come true. The candidates come through the same stale-line guard as the
 * pre-game read, so a line the box score has already decided never reaches the model, and each
 * surviving line carries what it still needs and how much regulation is left.
 */
export const LIVE_COOLDOWN_MS = 15 * 60_000;
/** Reaches `long` (20-100x). `moonshot` is left to the pre-game slate: in play it is noise. */
export const LIVE_BANDS = ["safe", "value", "mid", "long"];
export const LIVE_MAX_PER_BAND = 2;
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

/** Inside this many points, a game is still being contested and the starters keep their minutes. */
export const CONTESTED_MARGIN = 6;

/**
 * What the model is told beyond the structured inputs. The one thing this read knows that the
 * pre-game read could only guess is the SCOREBOARD, and the scoreboard is what decides whether the
 * starters play the minutes an under needed them not to have — a hand-built slate lost two tickets
 * to exactly that gap in an 87-86 game. So the margin goes in explicitly, with the reading that
 * follows from it, rather than being left for the model to infer from a line of box score.
 */
/**
 * The remaining-game projection of every surviving line, one per row, sorted by the computed chance:
 * what it still needs per remaining minute against the rate produced tonight. The lines whose
 * requirement tonight's rate already covers are the shape the live read exists to find; the ones
 * that need a reversion are named so they are not bought.
 */
export function projectionLines(props: PropRow[]): string {
  const rows = props.filter((p) => p.model?.live && p.line !== undefined);
  if (!rows.length) return "";
  const sorted = [...rows].sort((a, b) => (b.model?.computed ?? 0) - (a.model?.computed ?? 0));
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return sorted.slice(0, 24).map((p) => {
    const l = p.model!.live!;
    // Over: the requirement per minute against the rate produced tonight. Under: the room per minute
    // against the same rate — an under whose room is below the rate tonight needs the player to slow down.
    const under = p.side === "under";
    const met = under ? l.needed >= 0 && l.needPerMinute >= l.ratePerMinuteTonight && l.needPerMinute >= l.ratePerMinuteBlended : Number.isFinite(l.needPerMinute) && l.needPerMinute <= l.ratePerMinuteTonight;
    const reversion = !under && Number.isFinite(l.needPerMinute) && l.needPerMinute > 1.5 * Math.max(l.ratePerMinuteBlended, 0.001);
    const slowdown = under && l.needPerMinute < 0.7 * l.ratePerMinuteTonight;
    // The tags are machine labels the prompt names in English for both languages (the pt prompt is
    // the English text plus a writing instruction); the model writes its own strings in the reader's language.
    const tag = met ? "TONIGHT'S RATE ALREADY COVERS IT" : reversion ? "NEEDS A REVERSION — do not buy" : slowdown ? "NEEDS A SLOWDOWN — do not buy" : "";
    const requirement = l.needed > 0
      ? `${under ? "room for" : "needs"} ${l.needed} more in ~${l.remainingMinutes} min = ${l.needPerMinute >= 99 ? "∞" : l.needPerMinute.toFixed(2)}/min`
      : under ? "no room left: the next one busts it" : "needs nothing more";
    return `- ${p.player} ${p.market} ${p.side} ${p.line} @ ${p.odds ?? "?"} (pre-game reference): ${requirement} vs ${l.ratePerMinuteTonight.toFixed(2)}/min tonight (${l.minutesPlayed} min${l.fouls >= 3 ? `, ${l.fouls} PF` : ""}), ${l.ratePerMinutePreGame.toFixed(2)}/min pre-game → COMPUTED ${pct(p.model!.computed)}${tag ? ` — ${tag}` : ""}`;
  }).join("\n");
}

export function liveContext(snap: LiveSnapshot, parts: { leaders: string; trackerText: string; projections?: string }): string {
  const margin = Math.abs(snap.home.score - snap.away.score);
  const minutesLeft = Math.round(snap.regulationMinutes - snap.minute);
  return [
    snap.sportGroup === "basketball"
      ? `LIVE — period ${snap.period}, clock ${snap.clock}, ${minutesLeft} regulation minutes left, score ${snap.away.abbr} ${snap.away.score} @ ${snap.home.abbr} ${snap.home.score} (margin ${margin}). The pre-match lines below are stale: reason about what is left of the game.`
      : "",
    parts.leaders ? `LIVE PLAYER LINES:\n${parts.leaders}` : "",
    parts.projections ? `REMAINING-GAME PROJECTIONS — computed per line: the requirement per remaining minute, the rate produced tonight, the pre-game rate, and the chance of the final landing (minutes left already carry the fouls and the scoreboard):\n${parts.projections}` : "",
    parts.trackerText ? `PRE-MATCH TICKETS, TRACKED NOW:\n${parts.trackerText}` : "",
    `THE MARGIN IS KNOWN, SO USE IT. ${margin <= CONTESTED_MARGIN
      ? `The game is inside ${margin} point${margin === 1 ? "" : "s"} with ${minutesLeft} minutes left: the starters are going to play them. An under on a starter's counting stat is fighting the scoreboard — move unders onto bench minutes or onto a role that has visibly shrunk tonight, and treat overs on the players already producing as the cheaper side.`
      : `The game is ${margin} points apart with ${minutesLeft} minutes left. If it stays that way the closers sit, which favours unders on starters and cuts the tail off every over — say which way you are reading the rest of the game before you use either side.`}`,
    "BUILD REAL TICKETS, NOT A BULLETIN. Return tickets across the requested bands, including at least one at 10x or longer, built from lines the box score has NOT already decided. Every live leg must set the pace already established tonight beside what the line still needs — both are supplied per line above — and the leg to prefer is the one whose remaining requirement sits below the rate the player has already produced. A line marked NEEDS A REVERSION or NEEDS A SLOWDOWN does not go in a ticket; fairProbability on a live leg stays within 8 points of its COMPUTED chance.",
    "Never urge the reader to bet now; describe what changed and what it means. Live prices move on every play.",
  ].filter(Boolean).join("\n\n");
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
      // The same candidate pipeline the pre-game read uses, run against the live box score: the
      // guard drops every line the game has already settled and stamps the survivors with what
      // they still need. Without this the model has no player market to build on at all.
      const candidates = await buildPropCandidates(detail, { maxPlayers: 8, limit: 24 }).catch(() => null);
      const tracked = await liveTracker(user, sportKey, gameId, dateKey, lang);
      const trackerText = tracked.tickets.slice(0, 4).map((t) => `- ${t.title}: ${t.legs.map((l) => `${l.selection} → ${l.state}${l.probability !== null ? ` ${Math.round(l.probability * 100)}%` : ""} (${l.reason})`).join("; ")}`).join("\n");
      const leaders = snap.players.filter((p) => (p.stats.PTS ?? p.stats.SHOT ?? 0) > 0).slice(0, 10)
        .map((p) => `${p.name} (${p.team}): ${Object.entries(p.stats).filter(([k]) => ["MIN", "PTS", "REB", "AST", "PF", "SHOT", "SOG", "FC", "YC"].includes(k)).map(([k, v]) => `${k} ${v}`).join(", ")}`).join("\n");
      const extraContext = liveContext(snap, { leaders, trackerText, projections: projectionLines(candidates?.props ?? []) });
      const slate = await buildBets({
        game: detail.game, detail, props: candidates?.props ?? [], roles: candidates?.roles ?? [], minutes: candidates?.minutes ?? [], picks: [], dimers: [], x: null,
        bands: LIVE_BANDS, maxPerBand: LIVE_MAX_PER_BAND, lang, record: false, model: LIVE_MODEL,
        live: snap.sportGroup === "soccer" ? soccerState(snap) : null, extraContext,
      });
      const minute = Math.round(snap.minute);
      savePrediction({ scope: "live", sportKey, gameId, dateKey, lang, matchup: `${detail.game.away.displayName} @ ${detail.game.home.displayName}`, startsAt: detail.game.startsAt, slate: { ...slate, minute } as BetSlate });
      // Graded like every other ticket, kept out of the public ROI: the live record measures how
      // often a read lands, and the reference prices say nothing about what it would have paid.
      recordPredictions(detail.game, slate.suggestions, { live: { minute } });
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
