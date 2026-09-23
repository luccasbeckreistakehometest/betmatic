import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { servePredictionsDetailed } from "@/lib/server/predictions";
import { viewerFor } from "@/lib/server/entitlement";
import { pauseState } from "@/lib/server/settings";
import { slatePrices, type GameTeams } from "@/lib/server/book-compare";
import { getSlate, todayKey } from "@/lib/sources/espn";
import { getPlan } from "@/lib/plans";
import { normaliseLang } from "@/lib/i18n";
import { SOLD_SPORTS } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY = { books: [], fetchedAt: null, tickets: [], signals: [] };

/**
 * The books' prices on the cross-game tickets this viewer can see — the slate's answer to
 * /api/game/[gameId]/prices, and the reason a múltipla has a betslip link at all.
 *
 * The entitlement pass is the same one /api/predictions runs for `scope=slate` (the plan has to
 * include cross-game tickets, and a self-exclusion pause hides everything), so this route can only
 * put prices on tickets the viewer is already reading. Book names are shown on purpose — they are
 * prices, not the sources the white-label hides.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sportKey = url.searchParams.get("sport") ?? "";
  const rawDate = url.searchParams.get("date") ?? todayKey();
  const dateKey = /^\d{8}$/.test(rawDate) ? rawDate : todayKey();
  const lang = normaliseLang(url.searchParams.get("lang"));
  if (!SOLD_SPORTS.some((s) => s.key === sportKey)) return NextResponse.json(EMPTY);
  const user = await currentUser();
  if (!user || pauseState(user.id).paused) return NextResponse.json(EMPTY);
  const plan = user.planActive ? user.plan : getPlan("free");
  const served = servePredictionsDetailed({ scope: "slate", sportKey, dateKey, lang, plan, role: user.role, viewer: viewerFor(user) }).predictions[0];
  if (!served?.slate.suggestions.length) return NextResponse.json(EMPTY);
  try {
    // One scoreboard read for the whole slate (cached): a leg's "home"/"away" only means something
    // against its own match's teams, and a match the scoreboard does not carry leaves its legs
    // unpriced rather than read off another game's board.
    const games = await getSlate(dateKey, false, sportKey).catch(() => []);
    const teams = new Map<string, GameTeams>(games.map((g) => [g.id, { home: g.home, away: g.away }]));
    return NextResponse.json(slatePrices(served.slate.suggestions, teams, sportKey));
  } catch {
    return NextResponse.json(EMPTY);
  }
}
