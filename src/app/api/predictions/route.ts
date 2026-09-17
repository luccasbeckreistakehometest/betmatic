import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { servePredictionsDetailed } from "@/lib/server/predictions";
import { getPlan } from "@/lib/plans";
import { normaliseLang } from "@/lib/i18n";
import { todayKey } from "@/lib/sources/espn";
import { pauseState } from "@/lib/server/settings";
import { ownGeneratedGames, unlockedGames } from "@/lib/server/unlocks";
import { getSport } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only way the app reads tickets. Entitlements and the white-label scrub are applied here, so
 * whatever reaches the browser is already what this viewer is allowed to see. Read-only.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") === "slate" ? "slate" : "game";
  const sportKey = getSport(url.searchParams.get("sport") ?? undefined).key;
  const rawDate = url.searchParams.get("date") ?? todayKey();
  const dateKey = /^\d{8}$/.test(rawDate) ? rawDate : todayKey();
  const lang = normaliseLang(url.searchParams.get("lang"));

  const user = await currentUser();
  // Anonymous visitors get the free plan's view rather than an error.
  const plan = user?.planActive ? user.plan : getPlan("free");
  const role = user?.role === "admin" ? "admin" : "user";
  const viewer = user && plan.gamesPerDay !== null
    ? {
        unlocked: new Set(unlockedGames(user.id).map((g) => g.gameId)),
        ownGenerated: ownGeneratedGames(user.id, new Date(Date.now() - 2 * 86_400_000).toISOString()),
      }
    : user
      ? { unlocked: new Set<string>(), ownGenerated: ownGeneratedGames(user.id, new Date(Date.now() - 2 * 86_400_000).toISOString()) }
      : undefined;

  // A self-exclusion pause hides every ticket until its date; the plan's view resumes after.
  const pause = user ? pauseState(user.id) : { paused: false, until: null, daysLeft: 0 };
  const served = pause.paused
    ? { predictions: [], delayedGames: [] }
    : servePredictionsDetailed({ scope, sportKey, dateKey, lang, plan, role, viewer, anonymous: !user });

  return NextResponse.json({
    ...served,
    paused: pause.paused ? { until: pause.until } : null,
    plan: { id: plan.id, name: plan.name, gamesPerDay: plan.gamesPerDay, bands: plan.bands, crossGame: plan.crossGame, delayMinutes: plan.delayMinutes, sports: plan.sports },
    unlocked: user && plan.gamesPerDay !== null ? unlockedGames(user.id) : null,
    authenticated: Boolean(user),
    dateKey,
  });
}
