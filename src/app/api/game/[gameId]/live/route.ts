import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { apiError, rateLimited, requestLang } from "@/lib/server/api";
import { accountKey, hit } from "@/lib/server/rate-limit";
import { pauseState } from "@/lib/server/settings";
import { liveTracker } from "@/lib/server/live";
import { canReadLive, latestLiveRead, LIVE_COOLDOWN_MS, runLiveRead } from "@/lib/server/live-read";
import { scrubSlate } from "@/lib/server/whitelabel";
import { SOLD_SPORTS } from "@/lib/sports";
import type { Lang } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function parse(request: Request, gameId: string) {
  const url = new URL(request.url);
  const sportKey = url.searchParams.get("sport") ?? "";
  const dateKey = url.searchParams.get("date") ?? "";
  if (!/^[\w-]{1,40}$/.test(gameId) || !SOLD_SPORTS.some((s) => s.key === sportKey) || !/^\d{8}$/.test(dateKey)) return null;
  return { sportKey, dateKey };
}

/** The live panel: the snapshot, the tracked tickets and the latest live read. Hidden while paused. */
export async function GET(request: Request, ctx: { params: Promise<{ gameId: string }> }) {
  const user = await currentUser();
  const lang = requestLang(request, user?.lang) as Lang;
  if (!user) return apiError("unauthenticated", lang, 401);
  const { gameId } = await ctx.params;
  const q = parse(request, gameId);
  if (!q) return apiError("not_found", lang, 404);
  if (pauseState(user.id).paused) return NextResponse.json({ paused: true });
  const acct = hit("playerAccount", accountKey(user.id));
  if (!acct.ok) return rateLimited(acct, lang);
  const { snapshot, tickets } = await liveTracker(user, q.sportKey, gameId, q.dateKey, lang);
  const read = latestLiveRead(q.sportKey, gameId, q.dateKey, lang);
  const role = user.role === "admin" ? "admin" : "user";
  return NextResponse.json({
    snapshot, tickets,
    read: read ? { ...read, slate: scrubSlate(read.slate, role, lang) } : null,
    canRead: canReadLive(user),
    nextReadAt: read ? new Date(Date.parse(read.generatedAt) + LIVE_COOLDOWN_MS).toISOString() : null,
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ gameId: string }> }) {
  const user = await currentUser();
  const lang = requestLang(request, user?.lang) as Lang;
  if (!user) return apiError("unauthenticated", lang, 401);
  const { gameId } = await ctx.params;
  const q = parse(request, gameId);
  if (!q) return apiError("not_found", lang, 404);
  if (pauseState(user.id).paused) return apiError("paused", lang, 423);
  if (!canReadLive(user)) return apiError("forbidden", lang, 403);
  const acct = hit("aiAccount", accountKey(user.id));
  if (!acct.ok) return rateLimited(acct, lang);
  const out = await runLiveRead(user, q.sportKey, gameId, lang);
  if (out.status === "ok") {
    const role = user.role === "admin" ? "admin" : "user";
    return NextResponse.json({ read: { ...out.read, slate: scrubSlate(out.read.slate, role, lang) }, cached: out.cached, nextReadAt: new Date(Date.parse(out.read.generatedAt) + LIVE_COOLDOWN_MS).toISOString() });
  }
  if (out.status === "ai_budget") return apiError("ai_budget", lang, 503);
  if (out.status === "error" || out.status === "ai_off") return apiError("ai_unavailable", lang, out.status === "ai_off" ? 503 : 502);
  return NextResponse.json({ status: out.status }, { status: out.status === "not_allowed" ? 403 : 409 });
}
