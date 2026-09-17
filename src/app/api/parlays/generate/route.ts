import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { ensureSlateGenerated } from "@/lib/server/on-demand";
import { pauseState } from "@/lib/server/settings";
import { apiError, rateLimited, requestLang } from "@/lib/server/api";
import { accountKey, hit, ipKey } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Builds today's cross-game parlays for a sport once, for plans that include them. */
export async function POST(request: Request) {
  const user = await currentUser();
  const lang = requestLang(request, user?.lang);
  if (!user) return apiError("unauthenticated", lang, 401);
  if (pauseState(user.id).paused) return apiError("paused", lang, 423);
  if (user.role !== "admin") {
    const acct = hit("aiAccount", accountKey(user.id));
    if (!acct.ok) return rateLimited(acct, lang);
    const ip = hit("aiIp", ipKey(request));
    if (!ip.ok) return rateLimited(ip, lang);
  }
  const sportKey = new URL(request.url).searchParams.get("sport") ?? "";
  const result = await ensureSlateGenerated({ sportKey, user });
  if (result.status === "error" || result.status === "ai_budget") {
    return apiError(result.status === "ai_budget" ? "ai_budget" : "ai_unavailable", lang, 502, { status: result.status });
  }
  return NextResponse.json(result, { status: result.status === "not_allowed" ? 403 : 200 });
}
