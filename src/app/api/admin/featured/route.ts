import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/session";
import { featuredCostToday, featuredToday, runFeatured } from "@/lib/server/featured";
import { featuredConfig } from "@/lib/server/featured-policy";
import { getDb } from "@/lib/server/db";
import { SPORTS } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const forbidden = () => NextResponse.json({ error: "forbidden" }, { status: 403 });

/** Today's featured games, their cost and the last run. */
export async function GET() {
  if (!(await requireAdmin())) return forbidden();
  const lastRun = getDb().prepare("SELECT status, startedAt, finishedAt, note, costUsd, predictionsWritten FROM job_runs WHERE job='featured' ORDER BY startedAt DESC LIMIT 1").get() ?? null;
  return NextResponse.json({ games: featuredToday(), costUsd: featuredCostToday(), config: featuredConfig(process.env, SPORTS.map((s) => s.key)), lastRun });
}

/** "Gerar agora": the same job the scheduler runs. */
export async function POST() {
  if (!(await requireAdmin())) return forbidden();
  const result = await runFeatured();
  return NextResponse.json(result, { status: result.status === "error" ? 502 : 200 });
}
