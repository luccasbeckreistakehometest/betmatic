import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { servePredictions } from "@/lib/server/predictions";
import { getPlan } from "@/lib/plans";
import { normaliseLang } from "@/lib/i18n";
import { todayKey } from "@/lib/sources/espn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only way the app reads tickets. Entitlements and the white-label scrub are applied here, so
 * whatever reaches the browser is already what this viewer is allowed to see.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") === "slate" ? "slate" : "game";
  const sportKey = url.searchParams.get("sport") ?? "nba";
  const dateKey = url.searchParams.get("date") ?? todayKey();
  const lang = normaliseLang(url.searchParams.get("lang"));

  const user = await currentUser();
  // Anonymous visitors get the free plan's view rather than an error.
  const plan = user?.planActive ? user.plan : getPlan("free");
  const role = user?.role === "admin" ? "admin" : "user";

  const predictions = servePredictions({ scope, sportKey, dateKey, lang, plan, role });

  return NextResponse.json({
    predictions,
    plan: { id: plan.id, name: plan.name, gamesPerDay: plan.gamesPerDay, bands: plan.bands, crossGame: plan.crossGame, delayMinutes: plan.delayMinutes },
    authenticated: Boolean(user),
    dateKey,
  });
}
