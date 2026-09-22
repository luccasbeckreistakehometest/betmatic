import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { servedGameFor } from "@/lib/server/entitlement";
import { pauseState } from "@/lib/server/settings";
import { gamePrices } from "@/lib/server/book-compare";
import { getGameDetail } from "@/lib/sources/espn";
import { normaliseLang } from "@/lib/i18n";
import { SOLD_SPORTS } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY = { books: [], fetchedAt: null, tickets: [], signals: [] };

/**
 * The books' prices on the tickets this viewer can see. Book names are shown on purpose — they are
 * prices, not the sources the white-label hides — but a ticket's legs still only reach a viewer the
 * entitlement pass lets read them (same gate as /api/game/[id]/alerts).
 */
export async function GET(request: Request, ctx: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await ctx.params;
  const url = new URL(request.url);
  const sportKey = url.searchParams.get("sport") ?? "";
  const date = url.searchParams.get("date") ?? "";
  const lang = normaliseLang(url.searchParams.get("lang"));
  if (!/^\d{1,12}$/.test(gameId) || !SOLD_SPORTS.some((s) => s.key === sportKey) || !/^\d{8}$/.test(date)) return NextResponse.json(EMPTY);
  const user = await currentUser();
  if (!user || pauseState(user.id).paused) return NextResponse.json(EMPTY);
  const served = servedGameFor(user, { sportKey, gameId, dateKey: date, lang });
  if (!served) return NextResponse.json(EMPTY);
  const detail = await getGameDetail(gameId, false, sportKey).catch(() => null);
  if (!detail) return NextResponse.json(EMPTY);
  try {
    return NextResponse.json(gamePrices(gameId, served.slate.suggestions, detail.game, sportKey));
  } catch {
    return NextResponse.json(EMPTY);
  }
}
