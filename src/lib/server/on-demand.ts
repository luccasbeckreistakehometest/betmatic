import { getDb, newId, nowIso } from "@/lib/server/db";
import { findPrediction } from "@/lib/server/predictions";
import { generateGame } from "@/lib/server/generate-game";
import { onDemandCaps, onDemandVerdict, type OnDemandVerdict } from "@/lib/server/on-demand-policy";
import { refreshConfig } from "@/lib/server/refresh-policy";
import { espnDateKey, getGameDetail } from "@/lib/sources/espn";
import { SPORTS } from "@/lib/sports";
import { aiConfigured, describeAiError } from "@/lib/ai/client";
import type { PublicUser } from "@/lib/server/users";
import type { Lang } from "@/lib/i18n";

export type OnDemandResult =
  | { status: OnDemandVerdict | "generated"; dateKey: string }
  | { status: "not_found" | "ai_off" }
  | { status: "error"; message: string };

/** Ten people opening the same game at once share one generation instead of paying ten times. */
const inflight = new Map<string, Promise<OnDemandResult>>();

const todayCounts = (userId: string) => {
  const db = getDb();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  return {
    user: (db.prepare("SELECT COUNT(*) n FROM generation_requests WHERE userId = ? AND createdAt > ?").get(userId, since) as { n: number }).n,
    global: (db.prepare("SELECT COUNT(*) n FROM generation_requests WHERE createdAt > ?").get(since) as { n: number }).n,
  };
};

export async function ensureGameGenerated(args: { sportKey: string; gameId: string; user: PublicUser }): Promise<OnDemandResult> {
  const { sportKey, gameId, user } = args;
  if (!SPORTS.some((s) => s.key === sportKey)) return { status: "not_found" };
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
      getDb().prepare("UPDATE generation_requests SET status=?, costUsd=?, finishedAt=?, note=? WHERE id=?").run("ok", out.costUsd, nowIso(), out.notes.join(" | "), reqId);
      return { status: "generated", dateKey };
    } catch (error) {
      const message = describeAiError(error) ?? (error instanceof Error ? error.message : "failed");
      // A failed attempt is not charged against the caps: the row is removed so a retry is allowed.
      getDb().prepare("DELETE FROM generation_requests WHERE id = ?").run(reqId);
      return { status: "error", message };
    }
  })();

  inflight.set(key, task);
  try { return await task; } finally { inflight.delete(key); }
}
