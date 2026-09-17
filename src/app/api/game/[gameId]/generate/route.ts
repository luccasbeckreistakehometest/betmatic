import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { ensureGameGenerated } from "@/lib/server/on-demand";
import { pauseState } from "@/lib/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generation on demand: opening a game that has no tickets yet triggers one. Only signed-in users,
 * within the plan's and the server's daily caps; the same game in flight is shared, not repeated.
 */
export async function POST(request: Request, ctx: { params: Promise<{ gameId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ status: "unauthenticated" }, { status: 401 });
  const pause = pauseState(user.id);
  if (pause.paused) return NextResponse.json({ status: "paused", pausedUntil: pause.until }, { status: 423 });
  const { gameId } = await ctx.params;
  const sportKey = new URL(request.url).searchParams.get("sport") ?? "nba";
  const result = await ensureGameGenerated({ sportKey, gameId, user });
  const code = result.status === "error" ? 502 : result.status === "not_found" ? 404 : result.status === "ai_off" ? 503 : 200;
  return NextResponse.json(result, { status: code });
}
