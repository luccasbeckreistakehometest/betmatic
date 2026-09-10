import { getDb, newId, nowIso } from "@/lib/server/db";
import { getCoinPack, getPlan, periodPrice, type BillingPeriod } from "@/lib/plans";
import { activatePlan, adjustCoins } from "@/lib/server/users";

const BASE = "https://api.mercadopago.com";
const APP_URL = process.env.APP_URL || "http://localhost:3000";

export function mpConfigured(): boolean {
  return (process.env.MP_ACCESS_TOKEN ?? "").length > 0;
}

async function mp(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((data?.message as string) ?? `Mercado Pago ${res.status}`);
  return data;
}

const backUrls = {
  success: `${APP_URL}/app?pago=1`,
  failure: `${APP_URL}/planos?falhou=1`,
  pending: `${APP_URL}/planos?pendente=1`,
};

function recordPayment(input: {
  userId: string;
  kind: "coins" | "plan";
  reference: string;
  period?: BillingPeriod;
  amount: number;
  providerId: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO payments (id,userId,kind,reference,period,amount,status,providerId,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      newId("pay"),
      input.userId,
      input.kind,
      input.reference,
      input.period ?? null,
      input.amount,
      "pending",
      input.providerId,
      nowIso(),
    );
}

export async function createCoinCheckout(userId: string, packId: string, email?: string) {
  const pack = getCoinPack(packId);
  if (!pack) throw new Error("Pacote inválido");
  const total = pack.coins + pack.bonus;
  const pref = await mp("/checkout/preferences", {
    method: "POST",
    body: JSON.stringify({
      items: [{ title: `${total} coins — Betmatic`, quantity: 1, unit_price: pack.price, currency_id: "BRL" }],
      // The webhook needs to know who and what without trusting anything the browser sends back.
      external_reference: `coins|${userId}|${pack.id}`,
      ...(email ? { payer: { email } } : {}),
      back_urls: backUrls,
      auto_return: "approved",
      notification_url: `${APP_URL}/api/webhooks/mercadopago`,
    }),
  });
  recordPayment({ userId, kind: "coins", reference: pack.id, amount: pack.price, providerId: String(pref.id) });
  return { url: pref.init_point as string };
}

export async function createPlanCheckout(
  userId: string,
  planId: string,
  period: BillingPeriod,
  email?: string,
) {
  const plan = getPlan(planId);
  if (plan.id === "free") throw new Error("Plano gratuito não requer pagamento");
  const price = periodPrice(plan.monthlyPrice, period);
  const pref = await mp("/checkout/preferences", {
    method: "POST",
    body: JSON.stringify({
      items: [{ title: `Betmatic ${plan.name} — ${period}`, quantity: 1, unit_price: price, currency_id: "BRL" }],
      external_reference: `plan|${userId}|${plan.id}|${period}`,
      ...(email ? { payer: { email } } : {}),
      back_urls: backUrls,
      auto_return: "approved",
      notification_url: `${APP_URL}/api/webhooks/mercadopago`,
    }),
  });
  recordPayment({ userId, kind: "plan", reference: plan.id, period, amount: price, providerId: String(pref.id) });
  return { url: pref.init_point as string };
}

/**
 * Credits only on an approved payment fetched from Mercado Pago — never on the browser redirect,
 * which a user can forge. Idempotent: a repeated webhook for the same payment is ignored.
 */
export async function handleWebhook(paymentId: string): Promise<{ applied: boolean; note: string }> {
  const db = getDb();
  const already = db.prepare("SELECT id FROM payments WHERE providerId = ? AND status = 'approved'").get(paymentId);
  if (already) return { applied: false, note: "already processed" };

  const payment = await mp(`/v1/payments/${paymentId}`);
  if (payment.status !== "approved") return { applied: false, note: `status ${payment.status}` };

  const reference = String(payment.external_reference ?? "");
  const [kind, userId, ref, period] = reference.split("|");
  if (!userId) return { applied: false, note: "missing external_reference" };

  if (kind === "coins") {
    const pack = getCoinPack(ref);
    if (!pack) return { applied: false, note: "unknown pack" };
    adjustCoins(userId, pack.coins + pack.bonus, `purchase:${pack.id}`, { paymentId });
  } else if (kind === "plan") {
    activatePlan(userId, ref, (period as BillingPeriod) ?? "monthly");
  } else {
    return { applied: false, note: "unknown kind" };
  }

  db.prepare(
    "UPDATE payments SET status='approved', settledAt=?, providerId=? WHERE userId=? AND reference=? AND status='pending'",
  ).run(nowIso(), paymentId, userId, ref);
  return { applied: true, note: `${kind}:${ref}` };
}
