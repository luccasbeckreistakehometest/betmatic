import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/session";
import { getDb } from "@/lib/server/db";
import { countUsers, listUsers } from "@/lib/server/users";
import { predictionStats } from "@/lib/server/predictions";
import { recentRuns } from "@/lib/server/refresh-job";
import { ledgerSummary } from "@/lib/ledger/calibrate";
import { onboardingStats } from "@/lib/server/onboarding";
import { alertStats } from "@/lib/server/telegram";
import { reviewStats } from "@/lib/ledger/review";
import { responsibleStats } from "@/lib/server/settings";
import { budgetState, generationsToday, spendByDay } from "@/lib/server/ai-budget";
import { aiConfigured, aiModels, aiProviderName } from "@/lib/ai/client";
import { onDemandCaps } from "@/lib/server/on-demand-policy";
import { contactCounts } from "@/lib/server/contact";
import { listOps } from "@/lib/server/ops-log";
import { DELETED_USER_ID } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 403 });

  const db = getDb();
  const revenue = db
    .prepare("SELECT kind, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM payments WHERE status='approved' GROUP BY kind")
    .all() as { kind: string; n: number; total: number }[];
  const coinsSpent = (
    db.prepare("SELECT COALESCE(SUM(-delta),0) AS n FROM coin_ledger WHERE delta < 0").get() as { n: number }
  ).n;
  const byPlan = db.prepare("SELECT planId, COUNT(*) AS n FROM users WHERE id != ? GROUP BY planId").all(DELETED_USER_ID);
  const paying = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE planId != 'free' AND planExpiresAt > ? AND role != 'admin'").get(new Date().toISOString()) as { n: number }).n;
  const users = listUsers({ limit: 100 }).map((u) => ({
    id: u.id, email: u.email, name: u.name, role: u.role, planId: u.planId,
    planExpiresAt: u.planExpiresAt, coins: u.coins, createdAt: u.createdAt, lastSeenAt: u.lastSeenAt,
  }));

  return NextResponse.json({
    users,
    totals: {
      users: countUsers(),
      admins: users.filter((u) => u.role === "admin").length,
      paying,
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
    ai: {
      ...budgetState(),
      byDay: spendByDay(7),
      provider: aiProviderName(),
      configured: aiConfigured(),
      models: aiModels(),
      adminDailyCap: onDemandCaps(process.env).adminDailyCap,
      generations: generationsToday(),
    },
    contact: contactCounts(),
    ops: listOps(30),
  });
}
