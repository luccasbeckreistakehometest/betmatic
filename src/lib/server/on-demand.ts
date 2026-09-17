import { getDb, newId, nowIso } from "@/lib/server/db";
import { findGameInfo, findPrediction, savePrediction } from "@/lib/server/predictions";
import { buildSlateBets } from "@/lib/bets/builder";
import { localiseSlate } from "@/lib/bets/localise";
import { lastUsage } from "@/lib/ai/extract";
import { generateGame } from "@/lib/server/generate-game";
import { onDemandCaps, onDemandVerdict, slateCaps, slateVerdict, type OnDemandVerdict } from "@/lib/server/on-demand-policy";
import { buildPropCandidates } from "@/lib/props/candidates";
import { refreshConfig } from "@/lib/server/refresh-policy";
import { espnDateKey, getGameDetail, getSlateOrNearest, todayKey } from "@/lib/sources/espn";
import { SPORTS, sportSellsTickets } from "@/lib/sports";
import { aiConfigured } from "@/lib/ai/client";
import { AiBudgetExceededError, brasiliaDayStart } from "@/lib/server/ai-budget";
import { reportError } from "@/lib/server/ops-log";
import type { UnlockResult } from "@/lib/server/unlocks";
import type { PublicUser } from "@/lib/server/users";
import type { Lang } from "@/lib/i18n";

export type OnDemandResult =
  | { status: OnDemandVerdict | "generated"; dateKey: string }
  | { status: "cap_user"; unlocked: { gameId: string; sportKey: string }[] }
  | { status: "not_found" | "ai_off" | "unsupported" | "ai_budget" }
  | { status: "error" };

/** Ten people opening the same game at once share one generation instead of paying ten times. */
const inflight = new Map<string, Promise<OnDemandResult>>();

/** Counted per Brasília calendar day, the same day the plan's game allowance uses. */
export const todayCounts = (userId: string) => {
  const db = getDb();
  const since = brasiliaDayStart();
  return {
    user: (db.prepare("SELECT COUNT(*) n FROM generation_requests WHERE userId = ? AND createdAt > ? AND scope = 'game'").get(userId, since) as { n: number }).n,
    // Featured, slate, live and refresh generations have caps of their own.
    global: (db.prepare("SELECT COUNT(*) n FROM generation_requests WHERE createdAt > ? AND scope = 'game'").get(since) as { n: number }).n,
  };
};

/** A plan with a daily game allowance: `claim` records the pick, `release` gives it back. */
export interface GamePick {
  claim: () => UnlockResult;
  release: () => void;
}

/**
 * Opening a game. On a plan with a daily allowance the game becomes the user's pick only when it is
 * one they can actually use: it exists, has not started, and ends up with tickets. A started or
 * finished game never spends the pick (its tickets are public from kickoff), and a generation that
 * fails, is switched off or hits a cap hands the pick back.
 */
export async function ensureGameGenerated(args: { sportKey: string; gameId: string; user: PublicUser; pick?: GamePick }): Promise<OnDemandResult> {
  const { sportKey, gameId, user, pick } = args;
  const sport = SPORTS.find((s) => s.key === sportKey);
  if (!sport) return { status: "not_found" };
  // Tennis has no price feed, so a generation would spend tokens and return no ticket.
  if (!sportSellsTickets(sport)) return { status: "unsupported" };
  if (!pick) return generateShared(sportKey, gameId, user);

  const detail = await getGameDetail(gameId, false, sportKey).catch(() => null);
  // A fixture ESPN no longer lists can still be opened when its tickets are stored.
  const stored = detail ? null : findGameInfo(gameId);
  if (!detail && (!stored || stored.sportKey !== sportKey)) return { status: "not_found" };
  const startsAt = detail?.game.startsAt ?? stored?.startsAt ?? null;
  if (!startsAt || !Number.isFinite(Date.parse(startsAt))) return { status: "not_found" };
  const dateKey = detail ? espnDateKey(new Date(detail.game.startsAt)) : stored!.dateKey;
  const started = Date.parse(startsAt) <= Date.now() || (!!detail && detail.game.status !== "scheduled");
  const primary = refreshConfig(process.env, SPORTS.map((s) => s.key)).langs[0];
  const exists = !!findPrediction({ scope: "game", sportKey, gameId, dateKey, lang: primary });
  if (started) return { status: exists ? "exists" : "started", dateKey };
  if (!detail && !exists) return { status: "not_found" };

  const claimed = pick.claim();
  if (!claimed.ok) return { status: "cap_user", unlocked: claimed.unlocked };
  if (exists) return { status: "exists", dateKey };
  const result = await generateShared(sportKey, gameId, user);
  if (!claimed.alreadyUnlocked && result.status !== "generated" && result.status !== "exists") pick.release();
  return result;
}

/** Ten people opening the same game share one generation; the verdict (caps, started) is re-read inside. */
async function generateShared(sportKey: string, gameId: string, user: PublicUser): Promise<OnDemandResult> {
  const key = `${sportKey}:${gameId}`;
  const running = inflight.get(key);
  if (running) return running;

  const task = (async (): Promise<OnDemandResult> => {
    const detail = await getGameDetail(gameId, false, sportKey).catch(() => null);
    if (!detail) return { status: "not_found" };
    // Saved under the game's own date so the page that reads it looks in the same place.
    const dateKey = espnDateKey(new Date(detail.game.startsAt));
    const langs = refreshConfig(process.env, SPORTS.map((s) => s.key)).langs as Lang[];
    const counts = todayCounts(user.id);
    const verdict = onDemandVerdict({
      role: user.role, planGamesPerDay: user.plan.gamesPerDay, userCountToday: counts.user, globalCountToday: counts.global,
      ...onDemandCaps(process.env),
      alreadyGenerated: !!findPrediction({ scope: "game", sportKey, gameId, dateKey, lang: langs[0] }),
      started: Date.parse(detail.game.startsAt) <= Date.now() || detail.game.status !== "scheduled",
    });
    if (verdict !== "generate") return { status: verdict, dateKey };
    if (!aiConfigured()) return { status: "ai_off" };

    const reqId = newId("gr");
    getDb().prepare("INSERT INTO generation_requests (id,userId,sportKey,gameId,dateKey,status,createdAt) VALUES (?,?,?,?,?,?,?)")
      .run(reqId, user.id, sportKey, gameId, dateKey, "running", nowIso());
    try {
      const out = await generateGame({ sportKey, dateKey, detail, langs });
      getDb().prepare("UPDATE generation_requests SET status=?, costUsd=?, finishedAt=?, note=? WHERE id=?").run("ok", out.costUsd, nowIso(), [...out.notes, ...out.info].join(" | ").slice(0, 500), reqId);
      return { status: "generated", dateKey };
    } catch (error) {
      // The operator sees the reason (admin panel + log); the user sees a neutral message.
      reportError("ai.generate", error, { sportKey, gameId });
      // A failed attempt is not charged against the caps: the row is removed so a retry is allowed.
      getDb().prepare("DELETE FROM generation_requests WHERE id = ?").run(reqId);
      return error instanceof AiBudgetExceededError ? { status: "ai_budget" } : { status: "error" };
    }
  })();

  inflight.set(key, task);
  try { return await task; } finally { inflight.delete(key); }
}

export type SlateDemandResult =
  | { status: "generated" | "exists" | "too_few_games" | "cap_global" | "cap_user" | "not_allowed" | "ai_off" | "unsupported" | "ai_budget" | "error"; dateKey?: string };

const slateInflight = new Map<string, Promise<SlateDemandResult>>();
export const SLATE_BANDS = ["long", "moonshot", "lottery"];

const slateCounts = (userId: string) => {
  const db = getDb();
  const since = brasiliaDayStart();
  return {
    global: (db.prepare("SELECT COUNT(*) n FROM generation_requests WHERE scope='slate' AND createdAt > ?").get(since) as { n: number }).n,
    user: (db.prepare("SELECT COUNT(*) n FROM generation_requests WHERE scope='slate' AND userId = ? AND createdAt > ?").get(userId, since) as { n: number }).n,
  };
};

/**
 * Cross-game parlays on demand: one shared slate per sport per day, built when a plan with cross-game
 * tickets asks for it (slateVerdict decides). Up to SLATE_MAX_GAMES upcoming games, with their posted
 * player prices, in the long/moonshot/lottery bands; a ticket with two legs from one game is dropped.
 */
export async function ensureSlateGenerated(args: { sportKey: string; user: PublicUser }): Promise<SlateDemandResult> {
  const { sportKey, user } = args;
  const sport = SPORTS.find((s) => s.key === sportKey);
  if (!sport || !sportSellsTickets(sport)) return { status: "unsupported" };
  if (user.role !== "admin" && !user.plan.crossGame) return { status: "not_allowed" };
  const key = `slate:${sportKey}`;
  const running = slateInflight.get(key);
  if (running) return running;

  const task = (async (): Promise<SlateDemandResult> => {
    const slate = await getSlateOrNearest(todayKey(), false, sportKey).catch(() => null);
    if (!slate) return { status: "error" };
    const caps = slateCaps(process.env);
    const langs = refreshConfig(process.env, SPORTS.map((s) => s.key)).langs as Lang[];
    const [primary, ...derived] = langs;
    const upcoming = slate.games.filter((g) => g.status === "scheduled" && Date.parse(g.startsAt) > Date.now()).slice(0, caps.maxGames);
    const counts = slateCounts(user.id);
    const verdict = slateVerdict({
      role: user.role, crossGame: user.plan.crossGame, caps,
      exists: !!findPrediction({ scope: "slate", sportKey, gameId: null, dateKey: slate.dateKey, lang: primary }),
      upcomingGames: upcoming.length, globalCountToday: counts.global, userCountToday: counts.user,
    });
    if (verdict !== "generate") return { status: verdict, dateKey: slate.dateKey };
    if (!aiConfigured()) return { status: "ai_off" };

    const reqId = newId("gr");
    getDb().prepare("INSERT INTO generation_requests (id,userId,sportKey,gameId,dateKey,status,createdAt,scope) VALUES (?,?,?,?,?,?,?,?)")
      .run(reqId, user.id, sportKey, key, slate.dateKey, "running", nowIso(), "slate");
    try {
      const details = (await Promise.all(upcoming.map((g) => getGameDetail(g.id, false, sportKey).catch(() => null))))
        .filter((d): d is NonNullable<typeof d> => d !== null);
      const games = [];
      for (const d of details) {
        const candidates = await buildPropCandidates(d, { maxPlayers: 4, limit: 12 }).catch(() => null);
        games.push({ game: d.game, detail: d, props: candidates?.props ?? [] });
      }
      if (games.length < 2) throw new Error("fewer than two games with details");
      let cost = 0;
      const spend = () => { const c = lastUsage?.costUsd ?? 0; cost += c; return c; };
      const cross = await buildSlateBets({ games, bands: SLATE_BANDS, lang: primary });
      const matchup = (lang: Lang) => `${games.length} ${lang === "pt" ? "jogos" : "games"}`;
      savePrediction({ scope: "slate", sportKey, gameId: null, dateKey: slate.dateKey, lang: primary, matchup: matchup(primary), slate: cross, costUsd: spend() });
      for (const lang of derived) {
        try {
          savePrediction({ scope: "slate", sportKey, gameId: null, dateKey: slate.dateKey, lang, matchup: matchup(lang), slate: await localiseSlate(cross, primary, lang), costUsd: spend() });
        } catch (error) {
          reportError("ai.slate.localise", error, { sportKey, lang }, "warn");
        }
      }
      getDb().prepare("UPDATE generation_requests SET status='ok', costUsd=?, finishedAt=? WHERE id=?").run(cost, nowIso(), reqId);
      return { status: "generated", dateKey: slate.dateKey };
    } catch (error) {
      reportError("ai.slate", error, { sportKey });
      getDb().prepare("DELETE FROM generation_requests WHERE id = ?").run(reqId);
      return { status: error instanceof AiBudgetExceededError ? "ai_budget" : "error" };
    }
  })();

  slateInflight.set(key, task);
  try { return await task; } finally { slateInflight.delete(key); }
}
