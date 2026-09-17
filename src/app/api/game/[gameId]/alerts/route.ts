import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { servedGameFor } from "@/lib/server/entitlement";
import { pauseState } from "@/lib/server/settings";
import { alertsForGame } from "@/lib/server/lineups";
import { normaliseLang } from "@/lib/i18n";
import { SOLD_SPORTS } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lineup alerts on the tickets this viewer can see. An alert names a player, so it is only returned
 * for tickets the viewer is already allowed to read (same entitlement pass as /api/predictions).
 */
export async function GET(request: Request, ctx: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await ctx.params;
  const url = new URL(request.url);
  const sportKey = url.searchParams.get("sport") ?? "";
  const date = url.searchParams.get("date") ?? "";
  const lang = normaliseLang(url.searchParams.get("lang"));
  if (!/^[\w-]{1,40}$/.test(gameId) || !SOLD_SPORTS.some((s) => s.key === sportKey) || !/^\d{8}$/.test(date)) return NextResponse.json({ alerts: [] });
  const user = await currentUser();
  if (!user || pauseState(user.id).paused) return NextResponse.json({ alerts: [] });
  const served = servedGameFor(user, { sportKey, gameId, dateKey: date, lang });
  if (!served) return NextResponse.json({ alerts: [] });
  const visible = new Set(served.slate.suggestions.map((s) => s.id));
  const alerts = alertsForGame(gameId)
    .filter((a) => a.suggestionId && visible.has(a.suggestionId))
    .map((a) => ({ suggestionId: a.suggestionId!, legIndex: a.legIndex, kind: a.kind, player: a.player, detectedAt: a.detectedAt }));
  return NextResponse.json({ alerts });
}
