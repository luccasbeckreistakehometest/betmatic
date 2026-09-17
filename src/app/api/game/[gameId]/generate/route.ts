import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { ensureGameGenerated } from "@/lib/server/on-demand";
import { pauseState } from "@/lib/server/settings";
import { unlockGame } from "@/lib/server/unlocks";
import { apiError, rateLimited, requestLang } from "@/lib/server/api";
import { accountKey, hit, ipKey } from "@/lib/server/rate-limit";
import { SPORTS } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Opening a game: on a plan with a daily allowance this is where the user's choice is recorded,
 * and a game with no tickets yet is generated. Signed-in only, within the plan's and the server's
 * daily caps and the per-account/per-IP limits; the same game in flight is shared.
 */
export async function POST(request: Request, ctx: { params: Promise<{ gameId: string }> }) {
  const user = await currentUser();
  const lang = requestLang(request, user?.lang);
  if (!user) return NextResponse.json({ status: "unauthenticated" }, { status: 401 });
  const pause = pauseState(user.id);
  if (pause.paused) return NextResponse.json({ status: "paused", pausedUntil: pause.until }, { status: 423 });
  const { gameId } = await ctx.params;
  const sportKey = new URL(request.url).searchParams.get("sport") ?? "";
  if (!/^[\w-]{1,40}$/.test(gameId) || !SPORTS.some((s) => s.key === sportKey)) return NextResponse.json({ status: "not_found" }, { status: 404 });

  if (user.role !== "admin") {
    const acct = hit("aiAccount", accountKey(user.id));
    if (!acct.ok) return rateLimited(acct, lang);
    const ip = hit("aiIp", ipKey(request));
    if (!ip.ok) return rateLimited(ip, lang);
    if (user.plan.sports.length && !user.plan.sports.includes(sportKey)) {
      return NextResponse.json({ status: "plan_sport", planSports: user.plan.sports }, { status: 200 });
    }
  }

  const result = await ensureGameGenerated({
    sportKey, gameId, user,
    unlock: user.role === "admin" || user.plan.gamesPerDay === null ? undefined : () => unlockGame({ userId: user.id, plan: user.plan, gameId, sportKey }),
  });
  const code = result.status === "error" || result.status === "ai_budget" ? 502
    : result.status === "not_found" ? 404
      : result.status === "ai_off" || result.status === "unsupported" ? 503 : 200;
  if (code >= 500 && result.status !== "unsupported" && result.status !== "ai_off") {
    return apiError(result.status === "ai_budget" ? "ai_budget" : "ai_unavailable", lang, code, { status: result.status });
  }
  return NextResponse.json(result, { status: code });
}
