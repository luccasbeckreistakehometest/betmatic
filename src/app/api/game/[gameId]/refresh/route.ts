import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { apiError, rateLimited, requestLang } from "@/lib/server/api";
import { accountKey, hit } from "@/lib/server/rate-limit";
import { pauseState } from "@/lib/server/settings";
import { refreshState, runPriorityRefresh } from "@/lib/server/priority-refresh";
import { SOLD_SPORTS } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const running = new Map<string, Promise<Awaited<ReturnType<typeof runPriorityRefresh>>>>();

function parse(request: Request, gameId: string): string | null {
  const sportKey = new URL(request.url).searchParams.get("sport") ?? "";
  return /^[\w-]{1,40}$/.test(gameId) && SOLD_SPORTS.some((s) => s.key === sportKey) ? sportKey : null;
}

/** Max: whether the tickets of this game can be rebuilt now (an input changed), and the day's use. */
export async function GET(request: Request, ctx: { params: Promise<{ gameId: string }> }) {
  const user = await currentUser();
  const lang = requestLang(request, user?.lang);
  if (!user) return apiError("unauthenticated", lang, 401);
  const { gameId } = await ctx.params;
  const sportKey = parse(request, gameId);
  if (!sportKey) return apiError("not_found", lang, 404);
  if (user.role !== "admin" && user.plan.id !== "max") return NextResponse.json({ verdict: "not_max", reason: null });
  return NextResponse.json(await refreshState(user, sportKey, gameId));
}

export async function POST(request: Request, ctx: { params: Promise<{ gameId: string }> }) {
  const user = await currentUser();
  const lang = requestLang(request, user?.lang);
  if (!user) return apiError("unauthenticated", lang, 401);
  const { gameId } = await ctx.params;
  const sportKey = parse(request, gameId);
  if (!sportKey) return apiError("not_found", lang, 404);
  if (user.role !== "admin" && user.plan.id !== "max") return apiError("forbidden", lang, 403);
  if (pauseState(user.id).paused) return apiError("paused", lang, 423);
  const acct = hit("aiAccount", accountKey(user.id));
  if (!acct.ok) return rateLimited(acct, lang);

  const key = `${sportKey}:${gameId}`;
  const shared = running.get(key);
  // Someone is already rebuilding this game: wait for it instead of paying twice.
  const task = shared ?? runPriorityRefresh(user, sportKey, gameId);
  if (!shared) running.set(key, task);
  try {
    const out = await task;
    const code = out.status === "refreshed" ? 200 : out.status === "error" || out.status === "ai_budget" ? 502 : out.status === "ai_off" ? 503 : 409;
    if (code >= 500) return apiError(out.status === "ai_budget" ? "ai_budget" : "ai_unavailable", lang, code, { status: out.status });
    return NextResponse.json(out, { status: code });
  } finally {
    if (!shared) running.delete(key);
  }
}
