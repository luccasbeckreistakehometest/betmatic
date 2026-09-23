import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/session";
import { latestFactorStats, unmappedLegs } from "@/lib/server/factors-job";
import { calibrationSnapshot } from "@/lib/ledger/calibration-input";
import { readDailyItems, readDailySelection, sportsWithInventory } from "@/lib/server/daily-list";
import { brasiliaDay } from "@/lib/ledger/proof";
import { listHypotheses, unblockHypothesis } from "@/lib/ledger/hypotheses";
import { stakePolicyCompare, versionCompare, AB_MIN_PER_ARM } from "@/lib/ledger/ab";
import { readLedger } from "@/lib/ledger/store";
import { listPromptVersions, promptFreeze } from "@/lib/server/prompts";

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
    hypotheses: listHypotheses(80),
    versions: versionsPanel(),
    stakeAb: stakePolicyCompare(),
    minPerArm: AB_MIN_PER_ARM,
  });
}

/**
 * The two most recent prompt versions of the generator, compared on the tickets each of them wrote.
 * `versionCompare` refuses a verdict under 100 decided tickets per arm and says so in words, which
 * is what this panel is for: reading a change's effect off a sample too small to carry it is the
 * single easiest way to fool yourself here.
 */
function versionsPanel() {
  const versions = listPromptVersions("game").filter((v) => v.lang === "pt").slice(0, 8);
  const [current, previous] = versions;
  const entries = readLedger({ excludeLive: true });
  return {
    freeze: promptFreeze("game"),
    versions: versions.map((v) => ({ id: v.id, version: v.version, source: v.source, createdBy: v.createdBy, createdAt: v.createdAt, active: v.active })),
    compare: current && previous ? versionCompare(entries, previous.id, current.id) : null,
  };
}

/** Unblocking a contradicting hypothesis is a person's decision, never a job's. */
export async function POST(request: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "não autorizado" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { id?: string; action?: string };
  if (body.action !== "unblock" || !body.id) return NextResponse.json({ error: "ação desconhecida" }, { status: 400 });
  const row = unblockHypothesis(body.id, "admin (desbloqueio manual)");
  return row
    ? NextResponse.json({ ok: true, hypothesis: row })
    : NextResponse.json({ error: "essa hipótese não está bloqueada" }, { status: 400 });
}
