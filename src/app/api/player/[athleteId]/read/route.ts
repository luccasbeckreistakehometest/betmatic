import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { apiError, rateLimited } from "@/lib/server/api";
import { accountKey, hit, ipKey } from "@/lib/server/rate-limit";
import { pauseState } from "@/lib/server/settings";
import { adjustCoins, InsufficientCoinsError } from "@/lib/server/users";
import { canSeePlayer } from "@/lib/server/player-access";
import { buildPlayerProfile } from "@/lib/server/player-profile";
import { readDayKey, storedRead, writePlayerRead, type PlayerRead } from "@/lib/server/player-read";
import { AiBudgetExceededError } from "@/lib/server/ai-budget";
import { reportError } from "@/lib/server/ops-log";
import { aiConfigured } from "@/lib/ai/client";
import { ACTION_COST } from "@/lib/plans";
import { getSport, SPORTS } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  sport: z.string().max(20),
  lang: z.enum(["pt", "en"]).default("pt"),
  game: z.string().regex(/^[\w-]{1,40}$/).nullish(),
});

/** One generation per athlete/day/language at a time; a second request waits and reads it free. */
const inFlight = new Map<string, Promise<PlayerRead>>();

/**
 * "Leitura do analista". Coins price the work once: the first reader of the day pays, the text is
 * stored, and every later reader (any user) gets it free. A failed generation refunds.
 */
export async function POST(request: Request, ctx: { params: Promise<{ athleteId: string }> }) {
  const user = await currentUser();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  const lang = parsed.success ? parsed.data.lang : "pt";
  if (!user) return apiError("unauthenticated", lang, 401);
  const { athleteId } = await ctx.params;
  if (!parsed.success || !/^\d{1,12}$/.test(athleteId) || !SPORTS.some((s) => s.key === parsed.data.sport) || !getSport(parsed.data.sport).hasPlayerGamelog) return apiError("invalid_input", lang, 400);
  const sportKey = parsed.data.sport;
  if (pauseState(user.id).paused) return apiError("paused", lang, 423);
  if (!canSeePlayer(user, sportKey, athleteId)) return apiError("player_cap", lang, 403);

  const existing = storedRead(sportKey, athleteId, lang);
  if (existing) return NextResponse.json({ read: existing, coinsSpent: 0, cached: true, balance: user.coins });
  const flightKey = `${sportKey}:${athleteId}:${readDayKey()}:${lang}`;
  const pending = inFlight.get(flightKey);
  if (pending) {
    const read = await pending.catch(() => null);
    if (read) return NextResponse.json({ read, coinsSpent: 0, cached: true, balance: user.coins });
    return apiError("ai_unavailable", lang, 502);
  }
  if (!aiConfigured()) return apiError("ai_unavailable", lang, 503);

  const acct = hit("aiAccount", accountKey(user.id));
  if (!acct.ok) return rateLimited(acct, lang);
  const ip = hit("aiIp", ipKey(request));
  if (!ip.ok) return rateLimited(ip, lang);

  const price = user.role === "admin" ? 0 : ACTION_COST.player_read;
  if (price > 0) {
    try {
      adjustCoins(user.id, -price, "spend:player_read", { sportKey, athleteId });
    } catch (error) {
      if (error instanceof InsufficientCoinsError) return apiError("insufficient_coins", lang, 402, { needed: error.needed, balance: error.balance });
      throw error;
    }
  }

  const job = (async () => {
    const profile = await buildPlayerProfile(sportKey, athleteId, parsed.data.game ?? null);
    if (!profile) throw new Error("profile unavailable");
    return (await writePlayerRead(profile, lang, user.id)).read;
  })();
  inFlight.set(flightKey, job);
  try {
    const read = await job;
    return NextResponse.json({ read, coinsSpent: price, cached: false, balance: user.coins - price });
  } catch (error) {
    if (price > 0) adjustCoins(user.id, price, "refund:player_read", { athleteId });
    if (error instanceof AiBudgetExceededError) return apiError("ai_budget", lang, 503, { refunded: price });
    reportError("ai.player_read", error, { userId: user.id, athleteId }, "warn");
    return apiError("ai_unavailable", lang, 502, { refunded: price });
  } finally {
    inFlight.delete(flightKey);
  }
}
