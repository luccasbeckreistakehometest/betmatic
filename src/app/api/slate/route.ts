import { NextResponse } from "next/server";
import { getSlateOrNearest, todayKey } from "@/lib/sources/espn";
import { currentUser } from "@/lib/server/session";
import { apiError, requestLang } from "@/lib/server/api";
import { reportError } from "@/lib/server/ops-log";

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
    return NextResponse.json(await getSlateOrNearest(date, force, sport));
  } catch (error) {
    reportError("data.slate", error, { date, sport }, "warn");
    return apiError("slate_unavailable", requestLang(request, user?.lang), 502);
  }
}
