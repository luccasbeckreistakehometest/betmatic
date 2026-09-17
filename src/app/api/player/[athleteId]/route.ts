import { NextResponse } from "next/server";
import { recordRouteEvent } from "@/lib/server/analytics";
import { currentUser } from "@/lib/server/session";
import { apiError, rateLimited, requestLang } from "@/lib/server/api";
import { accountKey, hit } from "@/lib/server/rate-limit";
import { claimPlayer, releasePlayer } from "@/lib/server/player-access";
import { buildPlayerProfile } from "@/lib/server/player-profile";
import { storedRead } from "@/lib/server/player-read";
import { reportError } from "@/lib/server/ops-log";
import { aiConfigured } from "@/lib/ai/client";
import { ACTION_COST } from "@/lib/plans";
import { getSport, SPORTS } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The player deep dive's data (ESPN only). Signed in; the free plan opens one player a day, and a
 * profile that could not be built gives the slot back.
 */
export async function GET(request: Request, ctx: { params: Promise<{ athleteId: string }> }) {
  const user = await currentUser();
  const lang = requestLang(request, user?.lang);
  if (!user) return apiError("unauthenticated", lang, 401);
  const { athleteId } = await ctx.params;
  const url = new URL(request.url);
  const sportKey = url.searchParams.get("sport") ?? "";
  const gameId = url.searchParams.get("game");
  if (!/^\d{1,12}$/.test(athleteId) || !SPORTS.some((s) => s.key === sportKey) || !getSport(sportKey).hasPlayerGamelog) return apiError("not_found", lang, 404);
  if (gameId !== null && !/^[\w-]{1,40}$/.test(gameId)) return apiError("invalid_input", lang, 400);
  const acct = hit("playerAccount", accountKey(user.id));
  if (!acct.ok) return rateLimited(acct, lang);

  const access = claimPlayer(user, sportKey, athleteId);
  if (!access.ok) return apiError("player_cap", lang, 403, { used: access.used, limit: access.limit });
  try {
    const profile = await buildPlayerProfile(sportKey, athleteId, gameId);
    if (!profile) {
      releasePlayer(user, sportKey, athleteId);
      return apiError("not_found", lang, 404);
    }
    await recordRouteEvent("player_opened", user.id, { sportKey, limited: access.limit !== null });
    return NextResponse.json({
      profile,
      read: storedRead(sportKey, athleteId, lang),
      access: { unlimited: access.limit === null, used: access.used, limit: access.limit },
      readPrice: user.role === "admin" ? 0 : ACTION_COST.player_read,
      coins: user.coins,
      aiReady: aiConfigured(),
    });
  } catch (error) {
    releasePlayer(user, sportKey, athleteId);
    reportError("player.profile", error, { userId: user.id, athleteId }, "warn");
    return apiError("server_error", lang, 502);
  }
}
