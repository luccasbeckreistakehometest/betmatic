import { NextResponse } from "next/server";
import { getGameDetail } from "@/lib/sources/espn";
import { currentUser } from "@/lib/server/session";
import { scrubGameDetail } from "@/lib/server/whitelabel";
import { apiError, requestLang } from "@/lib/server/api";
import { reportError } from "@/lib/server/ops-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const url = new URL(request.url);
  const user = await currentUser();
  const role = user?.role === "admin" ? "admin" : "user";
  const lang = requestLang(request, user?.lang);
  // Bypassing the cache is an operator tool: it multiplies upstream calls.
  const force = role === "admin" && url.searchParams.get("force") === "1";
  const sport = url.searchParams.get("sport") ?? undefined;
  if (!/^[\w-]{1,40}$/.test(gameId)) return apiError("not_found", lang, 404);
  try {
    const detail = await getGameDetail(gameId, force, sport);
    if (!detail) return apiError("not_found", lang, 404);
    return NextResponse.json(scrubGameDetail(detail, role, lang));
  } catch (error) {
    // The upstream URL and status stay in the operator log.
    reportError("data.game", error, { gameId, sport }, "warn");
    return apiError("game_unavailable", lang, 502);
  }
}
