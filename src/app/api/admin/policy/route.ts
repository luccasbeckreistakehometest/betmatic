import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/session";
import { latestFactorStats, unmappedLegs } from "@/lib/server/factors-job";
import { calibrationSnapshot } from "@/lib/ledger/calibration-input";
import { readDailyItems, readDailySelection, sportsWithInventory } from "@/lib/server/daily-list";
import { brasiliaDay } from "@/lib/ledger/proof";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the operator needs to answer "why that one, and why not the other one" without opening
 * the code: the factors that are lit, the calibration each slice is sized with, the unmapped bucket,
 * and the day's list — the tickets chosen AND the ones discarded, each with its reason.
 */
export async function GET(request: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "não autorizado" }, { status: 403 });
  const url = new URL(request.url);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("day") ?? "") ? url.searchParams.get("day")! : brasiliaDay(new Date().toISOString());
  const sports = sportsWithInventory(day);
  const sportKey = sports.includes(url.searchParams.get("sport") ?? "") ? url.searchParams.get("sport")! : sports[0] ?? "wnba";

  const snapshot = calibrationSnapshot({ excludeDay: day });
  const selection = readDailySelection(day, sportKey);

  return NextResponse.json({
    day,
    sportKey,
    sports,
    factors: latestFactorStats(120),
    unmapped: unmappedLegs(),
    calibration: { pre: snapshot.pre, live: snapshot.live, slices: snapshot.slices.slice(0, 40) },
    selection: selection
      ? { ...selection, items: readDailyItems(day, sportKey) }
      : null,
  });
}
