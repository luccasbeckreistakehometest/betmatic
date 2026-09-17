import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/session";
import { getDb } from "@/lib/server/db";
import { listUsers } from "@/lib/server/users";
import { predictionStats } from "@/lib/server/predictions";
import { recentRuns } from "@/lib/server/refresh-job";
import { ledgerSummary } from "@/lib/ledger/calibrate";
import { onboardingStats } from "@/lib/server/onboarding";
import { alertStats } from "@/lib/server/telegram";
import { reviewStats } from "@/lib/ledger/review";
import { responsibleStats } from "@/lib/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "não autorizado" }, { status: 403 });

  const db = getDb();
  const revenue = db
    .prepare("SELECT kind, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM payments WHERE status='approved' GROUP BY kind")
    .all() as { kind: string; n: number; total: number }[];
  const coinsSpent = (
    db.prepare("SELECT COALESCE(SUM(-delta),0) AS n FROM coin_ledger WHERE delta < 0").get() as { n: number }
  ).n;
  const byPlan = db.prepare("SELECT planId, COUNT(*) AS n FROM users GROUP BY planId").all();
  const users = listUsers({ limit: 100 }).map((u) => ({
    id: u.id, email: u.email, name: u.name, role: u.role, planId: u.planId,
    planExpiresAt: u.planExpiresAt, coins: u.coins, createdAt: u.createdAt, lastSeenAt: u.lastSeenAt,
  }));

  return NextResponse.json({
    users,
    totals: {
      users: users.length,
      admins: users.filter((u) => u.role === "admin").length,
      paying: users.filter((u) => u.planId !== "free").length,
      coinsSpent,
    },
    revenue,
    byPlan,
    predictions: predictionStats(),
    jobs: recentRuns(8),
    ledger: ledgerSummary(),
    onboarding: onboardingStats(),
    alerts: alertStats(),
    reviews: reviewStats(),
    responsible: responsibleStats(),
  });
}
