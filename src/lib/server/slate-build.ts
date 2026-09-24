import { getDb, newId, nowIso } from "@/lib/server/db";
import { savePrediction } from "@/lib/server/predictions";
import { buildSlateBets } from "@/lib/bets/builder";
import { localiseSlate } from "@/lib/bets/localise";
import { lastUsage } from "@/lib/ai/extract";
import { buildPropCandidates } from "@/lib/props/candidates";
import { getGameDetail } from "@/lib/sources/espn";
import { reportError } from "@/lib/server/ops-log";
import type { Lang } from "@/lib/i18n";
import type { Game } from "@/lib/types";

/**
 * The one place a cross-game slate is built and filed.
 *
 * Two callers ask for one: the scheduler, every day, for the day's múltiplas entre jogos
 * (server/cross-daily.ts), and a reader who presses the button for their own (server/on-demand.ts).
 * They differ in WHO pays and in WHAT SHAPE is asked for — nothing else — so everything else lives
 * here rather than in two copies that drift: the details and the prop candidates, the generation
 * row that the caps and the bill are counted from, the primary language's build, the translations,
 * and the row's closing note.
 */

/** The account the scheduler builds as. Its rows are the platform's bill, never a reader's allowance. */
export const SYSTEM_SLATE_USER = "system";

export interface SlateBuildResult {
  status: "generated" | "too_few_games" | "error";
  tickets: number;
  costUsd: number;
  note: string;
}

export interface SlateBuildInput {
  sportKey: string;
  /** The slate's own day, the key the page reads it back under. */
  dateKey: string;
  /** The games to build across, already filtered to upcoming and capped by the caller. */
  games: Game[];
  langs: Lang[];
  /** Whose allowance and whose bill: a user id, or SYSTEM_SLATE_USER for the scheduler. */
  userId: string;
  /** The generation row's gameId, so two builds of one sport-day are one row. */
  key: string;
  /** The day's short window (bets/cross-policy.ts) rather than the long bands. */
  crossShape?: boolean;
}

/**
 * Builds and files one sport's cross-game slate. Throws nothing the caller has to catch for the
 * normal failures: a build that cannot happen comes back as a status, and the generation row is
 * removed so a retry is allowed. The one exception is the AI budget error, which the caller has to
 * see to tell the two kinds of "no" apart — rethrown as-is.
 */
export async function generateSlate(input: SlateBuildInput): Promise<SlateBuildResult> {
  const { sportKey, dateKey, langs, userId, key, crossShape = false } = input;
  const [primary, ...derived] = langs;
  const reqId = newId("gr");
  getDb().prepare("INSERT INTO generation_requests (id,userId,sportKey,gameId,dateKey,status,createdAt,scope) VALUES (?,?,?,?,?,?,?,?)")
    .run(reqId, userId, sportKey, key, dateKey, "running", nowIso(), "slate");
  try {
    const details = (await Promise.all(input.games.map((g) => getGameDetail(g.id, false, sportKey).catch(() => null))))
      .filter((d): d is NonNullable<typeof d> => d !== null);
    const games = [];
    for (const d of details) {
      const candidates = await buildPropCandidates(d, { maxPlayers: 4, limit: 12 }).catch(() => null);
      games.push({ game: d.game, detail: d, props: candidates?.props ?? [] });
    }
    // Two is not a formality: with one game there is no combination ACROSS games to make, and the
    // independence that makes this product's price honest is exactly what a single game cannot give.
    if (games.length < 2) {
      getDb().prepare("DELETE FROM generation_requests WHERE id = ?").run(reqId);
      return { status: "too_few_games", tickets: 0, costUsd: 0, note: "fewer than two games with details" };
    }

    let cost = 0;
    const spend = () => { const c = lastUsage?.costUsd ?? 0; cost += c; return c; };
    const cross = await buildSlateBets({ games, lang: primary, crossShape });
    const matchup = (lang: Lang) => `${games.length} ${lang === "pt" ? "jogos" : "games"}`;
    savePrediction({ scope: "slate", sportKey, gameId: null, dateKey, lang: primary, matchup: matchup(primary), slate: cross, costUsd: spend() });
    for (const lang of derived) {
      try {
        savePrediction({ scope: "slate", sportKey, gameId: null, dateKey, lang, matchup: matchup(lang), slate: await localiseSlate(cross, primary, lang), costUsd: spend() });
      } catch (error) {
        reportError("ai.slate.localise", error, { sportKey, lang }, "warn");
      }
    }
    const note = cross.suggestions.length ? `${cross.suggestions.length} tickets` : cross.dataNote.slice(0, 200);
    getDb().prepare("UPDATE generation_requests SET status='ok', costUsd=?, finishedAt=?, note=? WHERE id=?").run(cost, nowIso(), note, reqId);
    return { status: "generated", tickets: cross.suggestions.length, costUsd: cost, note };
  } catch (error) {
    // A failed attempt is not charged against the caps: the row goes, so a retry is allowed.
    getDb().prepare("DELETE FROM generation_requests WHERE id = ?").run(reqId);
    throw error;
  }
}
