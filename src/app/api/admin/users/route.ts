import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/session";
import { adjustCoins, coinHistory, findById, InsufficientCoinsError, listUsers, planIsActive, resetPasswordByAdmin, setDisabled, setPlanByAdmin } from "@/lib/server/users";
import { listPayments } from "@/lib/server/mercadopago";
import { logEvent } from "@/lib/server/ops-log";
import { PLANS } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbidden = () => NextResponse.json({ error: "forbidden" }, { status: 403 });

const publicRow = (u: NonNullable<ReturnType<typeof findById>>) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, planId: u.planId, planPeriod: u.planPeriod,
  planExpiresAt: u.planExpiresAt, planActive: planIsActive(u), coins: u.coins, lang: u.lang,
  createdAt: u.createdAt, lastSeenAt: u.lastSeenAt, disabledAt: u.disabledAt, mustChangePassword: !!u.mustChangePassword,
  termsAcceptedAt: u.termsAcceptedAt,
});

/** ?q= searches; ?id= returns one user with coin history and payments. */
export async function GET(request: Request) {
  if (!(await requireAdmin())) return forbidden();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const user = findById(id);
    if (!user) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ user: publicRow(user), coinHistory: coinHistory(id, 100), payments: listPayments({ userId: id, limit: 100 }) });
  }
  const users = listUsers({ search: url.searchParams.get("q") ?? "", limit: Number(url.searchParams.get("limit")) || 200 });
  return NextResponse.json({ users: users.map(publicRow) });
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_plan"), userId: z.string().max(80), planId: z.enum(PLANS.map((p) => p.id) as [string, ...string[]]), expiresAt: z.string().datetime().nullable() }),
  z.object({ action: z.literal("coins"), userId: z.string().max(80), delta: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0), note: z.string().trim().max(200).default("") }),
  z.object({ action: z.literal("reset_password"), userId: z.string().max(80) }),
  z.object({ action: z.literal("disable"), userId: z.string().max(80), disabled: z.boolean() }),
]);

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const body = parsed.data;
  const target = findById(body.userId);
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const audit = (extra: Record<string, unknown>) => logEvent("admin.user", { admin: admin.id, target: target.id, action: body.action, ...extra });

  switch (body.action) {
    case "set_plan": {
      if (body.planId !== "free" && (!body.expiresAt || Date.parse(body.expiresAt) <= Date.now())) {
        return NextResponse.json({ error: "expiry_required" }, { status: 400 });
      }
      setPlanByAdmin(target.id, body.planId, body.expiresAt);
      audit({ planId: body.planId, expiresAt: body.expiresAt });
      break;
    }
    case "coins": {
      try {
        adjustCoins(target.id, body.delta, "admin:adjust", { admin: admin.id, note: body.note });
      } catch (error) {
        if (error instanceof InsufficientCoinsError) return NextResponse.json({ error: "insufficient_coins", balance: error.balance }, { status: 400 });
        throw error;
      }
      audit({ delta: body.delta });
      break;
    }
    case "reset_password": {
      if (target.id === admin.id) return NextResponse.json({ error: "use_account_page" }, { status: 400 });
      const otp = await resetPasswordByAdmin(target.id);
      audit({});
      // Shown once to the admin, never stored in clear or logged.
      return NextResponse.json({ ok: true, oneTimePassword: otp, user: publicRow(findById(target.id)!) });
    }
    case "disable": {
      if (target.id === admin.id || target.role === "admin") return NextResponse.json({ error: "cannot_disable_admin" }, { status: 400 });
      setDisabled(target.id, body.disabled);
      audit({ disabled: body.disabled });
      break;
    }
  }
  return NextResponse.json({ ok: true, user: publicRow(findById(target.id)!) });
}
