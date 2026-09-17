import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { apiError, requestLang } from "@/lib/server/api";
import { pauseState } from "@/lib/server/settings";
import { reportFor, storedReports } from "@/lib/server/weekly-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The discipline report: the last seven days computed now, plus the weeks already written. */
export async function GET(request: Request) {
  const user = await currentUser();
  const lang = requestLang(request, user?.lang);
  if (!user) return apiError("unauthenticated", lang, 401);
  const pause = pauseState(user.id);
  return NextResponse.json({ current: reportFor(user.id), history: storedReports(user.id), paused: pause.paused ? { until: pause.until } : null });
}
