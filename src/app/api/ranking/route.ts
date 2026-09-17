import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { leaderboard } from "@/lib/server/leaderboard";
import { getSettings } from "@/lib/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Members' ROI and units under their handles — only those who opted in, only with ten decided bets. */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const period = new URL(request.url).searchParams.get("period") === "all" ? "all" : "week";
  const s = getSettings(user.id);
  return NextResponse.json({ ...leaderboard(period, user.id), viewer: { optedIn: s.leaderboardOptIn, handle: s.leaderboardOptIn ? s.handle : null } });
}
