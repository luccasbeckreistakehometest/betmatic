import { NextResponse } from "next/server";
import { buildSlateBets } from "@/lib/bets/builder";
import { getGameDetail, getSlateOrNearest, todayKey } from "@/lib/sources/espn";
import { buildPropCandidates } from "@/lib/props/candidates";
import { normaliseLang } from "@/lib/i18n";
import { aiConfigured } from "@/lib/ai/client";
import type { Game, GameDetail, PropRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_GAMES = 12;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? todayKey();
  const sport = url.searchParams.get("sport") ?? undefined;
  const lang = normaliseLang(url.searchParams.get("lang"));
  const bands = (url.searchParams.get("bands") ?? "long,moonshot")
    .split(",").map((b) => b.trim()).filter(Boolean);

  if (!aiConfigured()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set." }, { status: 400 });
  }

  try {
    const slate = await getSlateOrNearest(date, false, sport);
    // Cross-game tickets only make sense on games that have not started.
    const upcoming = slate.games.filter((g) => g.status === "scheduled").slice(0, MAX_GAMES);
    if (upcoming.length < 2) {
      return NextResponse.json({
        suggestions: [],
        dataNote:
          `Only ${upcoming.length} upcoming game${upcoming.length === 1 ? "" : "s"} on ${slate.dateKey} — a cross-game ticket needs at least two.`,
        dateKey: slate.dateKey,
      });
    }

    const details = await Promise.all(
      upcoming.map(async (game: Game) => {
        const detail = await getGameDetail(game.id, false, game.sportKey).catch(() => null);
        if (!detail) return null;
        // Game-log candidates give the builder player legs even with no props tool logged in.
        const props = await buildPropCandidates(detail).catch(() => []);
        return { game: detail.game, detail, props };
      }),
    );
    const usable = details.filter(
      (d): d is { game: Game; detail: GameDetail; props: PropRow[] } => d !== null,
    );

    const result = await buildSlateBets({ games: usable, bands, lang });
    return NextResponse.json({ ...result, dateKey: slate.dateKey, games: usable.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to build slate tickets" },
      { status: 502 },
    );
  }
}
