import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { apiError, rateLimited, requestLang } from "@/lib/server/api";
import { accountKey, hit } from "@/lib/server/rate-limit";
import { canSeePlayer } from "@/lib/server/player-access";
import { teammateLog } from "@/lib/server/player-profile";
import { getSport, SPORTS } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which games a teammate played (and his minutes), for the "com/sem" split of a player already opened. */
export async function GET(request: Request, ctx: { params: Promise<{ athleteId: string }> }) {
  const user = await currentUser();
  const lang = requestLang(request, user?.lang);
  if (!user) return apiError("unauthenticated", lang, 401);
  const { athleteId } = await ctx.params;
  const url = new URL(request.url);
  const sportKey = url.searchParams.get("sport") ?? "";
  const mate = url.searchParams.get("mate") ?? "";
  if (!/^\d{1,12}$/.test(athleteId) || !/^\d{1,12}$/.test(mate) || !SPORTS.some((s) => s.key === sportKey) || !getSport(sportKey).hasPlayerGamelog) return apiError("not_found", lang, 404);
  if (!canSeePlayer(user, sportKey, athleteId)) return apiError("player_cap", lang, 403);
  const acct = hit("playerAccount", accountKey(user.id));
  if (!acct.ok) return rateLimited(acct, lang);
  const games = await teammateLog(sportKey, mate).catch(() => []);
  return NextResponse.json({ athleteId: mate, games });
}
