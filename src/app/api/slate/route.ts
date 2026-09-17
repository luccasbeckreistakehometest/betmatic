import { NextResponse } from "next/server";
import { getSlateOrNearest, todayKey } from "@/lib/sources/espn";
import { currentUser } from "@/lib/server/session";
import { apiError, requestLang } from "@/lib/server/api";
import { reportError } from "@/lib/server/ops-log";
import { scrubGame } from "@/lib/server/whitelabel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("date") ?? todayKey();
  const date = /^\d{8}$/.test(raw) ? raw : todayKey();
  const user = await currentUser();
  const force = user?.role === "admin" && url.searchParams.get("force") === "1";
  const sport = url.searchParams.get("sport") ?? undefined;
  try {
    const slate = await getSlateOrNearest(date, force, sport);
    const role = user?.role === "admin" ? "admin" : "user";
    const lang = requestLang(request, user?.lang);
    return NextResponse.json({ ...slate, games: slate.games.map((g) => scrubGame(g, role, lang)) });
  } catch (error) {
    reportError("data.slate", error, { date, sport }, "warn");
    return apiError("slate_unavailable", requestLang(request, user?.lang), 502);
  }
}
