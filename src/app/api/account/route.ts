import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { coinHistory } from "@/lib/server/users";
import { listUserPayments } from "@/lib/server/mercadopago";
import { apiError, requestLang } from "@/lib/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything the account page shows: plan and expiry, coin history, payments. Read-only. */
export async function GET(request: Request) {
  const user = await currentUser({ pendingPasswordChange: true });
  if (!user) return apiError("unauthenticated", requestLang(request), 401);
  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      lang: user.lang,
      coins: user.coins,
      createdAt: user.createdAt,
      mustChangePassword: !!user.mustChangePassword,
      termsAcceptedAt: user.termsAcceptedAt,
    },
    plan: {
      id: user.plan.id,
      name: user.plan.name,
      // The stored plan, even when it lapsed, so the page can say "expired on …".
      storedPlanId: user.planId,
      period: user.planPeriod,
      expiresAt: user.planExpiresAt,
      active: user.planActive,
    },
    coinHistory: coinHistory(user.id, 50),
    payments: listUserPayments(user.id),
  });
}
