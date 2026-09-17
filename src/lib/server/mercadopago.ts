import { createHmac } from "node:crypto";
import { getDb, newId, nowIso } from "@/lib/server/db";
import { getCoinPack, getPlan, PERIOD, periodPrice, type BillingPeriod } from "@/lib/plans";
import { activatePlan, adjustCoins, findById, nextPlanExpiry, type PlanState, type UserRow } from "@/lib/server/users";
import { creditReferralOnPurchase, reverseReferralForPayment } from "@/lib/server/referral";
import { reportError } from "@/lib/server/ops-log";
import { requireBaseUrl } from "@/lib/base-url";
import { safeEqual } from "@/lib/server/auth";
import { envValue } from "@/lib/env";

/** MP_API_BASE exists only so the e2e suite can point checkout at a local fake. */
const apiBase = () => process.env.MP_API_BASE || "https://api.mercadopago.com";

export function mpConfigured(): boolean {
  return envValue("MP_ACCESS_TOKEN").length > 0;
}

/** Thrown when Mercado Pago cannot be reached or answers with an error; the webhook maps it to 5xx. */
export class MercadoPagoError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "MercadoPagoError";
  }
}

type Fetcher = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;

const liveFetcher: Fetcher = async (path, init) => {
  const res = await fetch(apiBase() + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${envValue("MP_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  }).catch((error: unknown) => {
    throw new MercadoPagoError(`Mercado Pago unreachable: ${error instanceof Error ? error.message : String(error)}`);
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new MercadoPagoError(String(data?.message ?? `Mercado Pago ${res.status}`), res.status);
  return data;
};

let fetcher: Fetcher = liveFetcher;
/** Tests swap the HTTP layer; production never calls this. */
export function setMercadoPagoFetcher(next: Fetcher | null): void {
  fetcher = next ?? liveFetcher;
}

/** Return URLs and the per-preference webhook. Refuses to build them against localhost. */
export function checkoutUrls(): { back_urls: Record<string, string>; notification_url: string } {
  const base = requireBaseUrl();
  return {
    back_urls: {
      success: `${base}/pagamento/sucesso`,
      failure: `${base}/pagamento/falhou`,
      pending: `${base}/pagamento/pendente`,
    },
    notification_url: `${base}/api/webhooks/mercadopago`,
  };
}

export interface PaymentRow {
  id: string;
  userId: string;
  kind: "coins" | "plan";
  reference: string;
  period: BillingPeriod | null;
  amount: number;
  currency: string;
  status: string;
  providerId: string | null;
  preferenceId: string | null;
  providerPaymentId: string | null;
  statusDetail: string | null;
  createdAt: string;
  settledAt: string | null;
  reversedAt: string | null;
  planBefore?: string | null;
  planAfter?: string | null;
}

/** The row id travels as external_reference, so the webhook credits exactly this purchase. */
const REF_PREFIX = "bm:";

function insertPending(input: { userId: string; kind: "coins" | "plan"; reference: string; period: BillingPeriod | null; amount: number }): string {
  const id = newId("pay");
  getDb()
    .prepare(`INSERT INTO payments (id,userId,kind,reference,period,amount,currency,status,createdAt) VALUES (?,?,?,?,?,?,'BRL','pending',?)`)
    .run(id, input.userId, input.kind, input.reference, input.period, input.amount, nowIso());
  return id;
}

async function createPreference(rowId: string, title: string, price: number, email?: string): Promise<{ url: string }> {
  const urls = checkoutUrls();
  try {
    const pref = await fetcher("/checkout/preferences", {
      method: "POST",
      body: JSON.stringify({
        items: [{ id: rowId, title, quantity: 1, unit_price: price, currency_id: "BRL" }],
        external_reference: `${REF_PREFIX}${rowId}`,
        ...(email ? { payer: { email } } : {}),
        ...urls,
        auto_return: "approved",
        statement_descriptor: "BETMATIC",
      }),
    });
    const url = String(pref.init_point ?? "");
    if (!/^https:\/\//.test(url) && !(process.env.MP_API_BASE && url.startsWith(process.env.MP_API_BASE))) throw new MercadoPagoError("Mercado Pago returned no init_point");
    getDb().prepare("UPDATE payments SET preferenceId = ?, providerId = ? WHERE id = ?").run(String(pref.id ?? ""), String(pref.id ?? ""), rowId);
    return { url };
  } catch (error) {
    // The attempt never reached the buyer; keep the row for the audit trail but close it.
    getDb().prepare("UPDATE payments SET status = 'failed', statusDetail = ? WHERE id = ?").run(error instanceof Error ? error.message.slice(0, 200) : "failed", rowId);
    throw error;
  }
}

export async function createCoinCheckout(userId: string, packId: string, email?: string): Promise<{ url: string; paymentId: string }> {
  const pack = getCoinPack(packId);
  if (!pack) throw new RangeError("unknown_pack");
  checkoutUrls(); // fail before writing anything when the base URL is missing
  const rowId = insertPending({ userId, kind: "coins", reference: pack.id, period: null, amount: pack.price });
  const { url } = await createPreference(rowId, `Betmatic — ${pack.coins + pack.bonus} coins`, pack.price, email);
  return { url, paymentId: rowId };
}

export async function createPlanCheckout(userId: string, planId: string, period: BillingPeriod, email?: string): Promise<{ url: string; paymentId: string }> {
  const plan = getPlan(planId);
  if (plan.id !== planId || plan.monthlyPrice <= 0) throw new RangeError("unknown_plan");
  if (!PERIOD[period]) throw new RangeError("unknown_period");
  checkoutUrls();
  const price = periodPrice(plan.monthlyPrice, period);
  const rowId = insertPending({ userId, kind: "plan", reference: plan.id, period, amount: price });
  const months = PERIOD[period].months;
  const { url } = await createPreference(rowId, `Betmatic ${plan.name} — ${months} ${months === 1 ? "mês" : "meses"} (pré-pago)`, price, email);
  return { url, paymentId: rowId };
}

export type WebhookOutcome =
  | "credited" | "already_processed" | "reversed" | "rejected" | "pending"
  | "ignored_unknown_reference" | "ignored_amount_mismatch" | "ignored_status";

/** Which of our rows a Mercado Pago payment belongs to — only the row id we issued counts. */
function rowForPayment(payment: Record<string, unknown>): PaymentRow | null {
  const ref = String(payment.external_reference ?? "");
  if (!ref.startsWith(REF_PREFIX)) return null;
  return (getDb().prepare("SELECT * FROM payments WHERE id = ?").get(ref.slice(REF_PREFIX.length)) as PaymentRow | undefined) ?? null;
}

function creditRow(row: PaymentRow, paymentId: string, settledAt: string): void {
  const meta = { paymentId, paymentRow: row.id };
  if (row.kind === "coins") {
    const pack = getCoinPack(row.reference);
    if (!pack) throw new Error(`unknown pack ${row.reference}`);
    adjustCoins(row.userId, pack.coins + pack.bonus, `purchase:${pack.id}`, meta);
  } else {
    const { before, after } = activatePlan(row.userId, row.reference, (row.period ?? "monthly") as BillingPeriod, meta, new Date(settledAt));
    getDb().prepare("UPDATE payments SET planBefore = ?, planAfter = ? WHERE id = ?").run(JSON.stringify(before), JSON.stringify(after), row.id);
  }
}

function parsePlanState(json: string | null | undefined): PlanState | null {
  try {
    const v = json ? (JSON.parse(json) as PlanState) : null;
    return v && typeof v.planId === "string" ? { planId: v.planId, planPeriod: v.planPeriod ?? "monthly", planExpiresAt: v.planExpiresAt ?? null } : null;
  } catch {
    return null;
  }
}

const matches = (state: PlanState, user: Pick<UserRow, "planId" | "planExpiresAt">) =>
  state.planId === user.planId && state.planExpiresAt === (user.planExpiresAt ?? null);

/**
 * Takes a refunded plan purchase out of the account's history. The plan is rebuilt from the state
 * right before that purchase, replaying every later plan purchase that still stands at the moment it
 * was paid — so days converted out of the refunded plan into another one leave with it. When the
 * account no longer matches what those purchases produced (an admin changed it since), nothing is
 * guessed: the operator gets an ops_log row to settle it by hand.
 * Returns false for rows credited before the states were recorded.
 */
function removePlanPurchase(row: PaymentRow, user: UserRow, paymentId: string): boolean {
  const before = parsePlanState(row.planBefore);
  if (!before) return false;
  const db = getDb();
  const chain = db.prepare("SELECT * FROM payments WHERE userId = ? AND kind = 'plan' AND status = 'approved' ORDER BY settledAt ASC, rowid ASC").all(row.userId) as PaymentRow[];
  const later = chain.slice(chain.findIndex((p) => p.id === row.id) + 1);
  const expected = parsePlanState((later.at(-1) ?? row).planAfter);
  if (!expected || later.some((p) => !parsePlanState(p.planAfter) || !p.settledAt) || !matches(expected, user)) {
    reportError("payments.reversal", new Error("the plan changed outside purchases since this payment — adjust it by hand in /admin"), { paymentId, paymentRow: row.id, userId: row.userId });
    return true;
  }
  let state = before;
  for (const p of later) {
    const period = (p.period ?? "monthly") as BillingPeriod;
    const next: PlanState = { planId: getPlan(p.reference).id, planPeriod: period, planExpiresAt: nextPlanExpiry(state, p.reference, period, new Date(p.settledAt!)).toISOString() };
    db.prepare("UPDATE payments SET planBefore = ?, planAfter = ? WHERE id = ?").run(JSON.stringify(state), JSON.stringify(next), p.id);
    state = next;
  }
  const lapsed = state.planId === "free" || !state.planExpiresAt || state.planExpiresAt <= nowIso();
  db.prepare("UPDATE users SET planId = ?, planPeriod = ?, planExpiresAt = ? WHERE id = ?")
    .run(lapsed ? "free" : state.planId, lapsed ? "monthly" : state.planPeriod, lapsed ? null : state.planExpiresAt, row.userId);
  return true;
}

/**
 * Undo a credit after a refund or chargeback: coins come back out (never below zero, so coins
 * already spent stay spent), paid time is removed, and a referral this purchase paid is taken back.
 */
function reverseRow(row: PaymentRow, paymentId: string): void {
  const meta = { paymentId, paymentRow: row.id };
  const db = getDb();
  const user = findById(row.userId);
  if (!user) return; // erased account: nothing left to take back
  reverseReferralForPayment(row.userId, row.id);
  const claw = (coins: number, reason: string) => {
    const amount = Math.min(coins, findById(row.userId)?.coins ?? 0);
    if (amount > 0) adjustCoins(row.userId, -amount, reason, meta);
  };
  if (row.kind === "coins") {
    const pack = getCoinPack(row.reference);
    if (pack) claw(pack.coins + pack.bonus, `reversal:${pack.id}`);
    return;
  }
  const plan = getPlan(row.reference);
  claw(plan.coinsPerPeriod, `reversal:plan:${plan.id}`);
  if (removePlanPurchase(row, user, paymentId)) return;
  // Rows credited before plan states were recorded: take the months off when the plan still matches.
  if (user.planId !== plan.id || !user.planExpiresAt) return;
  const expiry = new Date(user.planExpiresAt);
  expiry.setMonth(expiry.getMonth() - (PERIOD[(row.period ?? "monthly") as BillingPeriod]?.months ?? 1));
  if (expiry.getTime() <= Date.now()) {
    db.prepare("UPDATE users SET planId = 'free', planPeriod = 'monthly', planExpiresAt = NULL WHERE id = ?").run(row.userId);
  } else {
    db.prepare("UPDATE users SET planExpiresAt = ? WHERE id = ?").run(expiry.toISOString(), row.userId);
  }
}

/**
 * Applies one Mercado Pago payment state. Everything below the fetch runs in one IMMEDIATE
 * transaction; the processed_payments primary key is what makes a duplicate or concurrent
 * delivery a no-op. Throws MercadoPagoError when the lookup fails, so the route answers 5xx and
 * Mercado Pago retries.
 */
export async function handleWebhook(paymentId: string): Promise<{ outcome: WebhookOutcome; note: string }> {
  if (!/^\d{1,30}$/.test(paymentId)) return { outcome: "ignored_status", note: "not a payment id" };
  const payment = await fetcher(`/v1/payments/${paymentId}`);
  const status = String(payment.status ?? "");
  const db = getDb();

  const apply = db.transaction((): { outcome: WebhookOutcome; note: string } => {
    const row = rowForPayment(payment);
    const mark = (key: string, action: string) =>
      db.prepare("INSERT OR IGNORE INTO processed_payments (key,paymentId,paymentRowId,action,status,amount,processedAt) VALUES (?,?,?,?,?,?,?)")
        .run(key, paymentId, row?.id ?? null, action, status, Number(payment.transaction_amount ?? 0), nowIso()).changes > 0;

    if (!row) {
      mark(`${paymentId}:ignored`, "ignored");
      return { outcome: "ignored_unknown_reference", note: String(payment.external_reference ?? "") };
    }

    if (status === "approved") {
      if (!mark(`${paymentId}:credit`, "credit")) return { outcome: "already_processed", note: row.id };
      // A row is paid once. A second approved payment for the same checkout is not credited: the buyer
      // paid twice, so the operator is told to refund it.
      if (row.status === "approved" || row.providerPaymentId) {
        const note = `duplicate payment ${paymentId} for a row already paid by ${row.providerPaymentId ?? "?"}: refund it in Mercado Pago`;
        db.prepare("UPDATE payments SET statusDetail = ? WHERE id = ?").run(note.slice(0, 200), row.id);
        reportError("payments.duplicate", new Error(note), { paymentId, paymentRow: row.id, userId: row.userId, amount: Number(payment.transaction_amount ?? 0) });
        return { outcome: "already_processed", note: `row ${row.id} already paid` };
      }
      const paid = Number(payment.transaction_amount ?? 0);
      const currency = String(payment.currency_id ?? "BRL");
      if (currency !== "BRL" || paid + 0.005 < row.amount) {
        db.prepare("UPDATE payments SET statusDetail = ? WHERE id = ?").run(`amount mismatch: ${currency} ${paid}`, row.id);
        reportError("payments.amount_mismatch", new Error(`payment ${paymentId} paid ${currency} ${paid} for a R$ ${row.amount} row: not credited, refund or credit by hand`), { paymentId, paymentRow: row.id, userId: row.userId });
        return { outcome: "ignored_amount_mismatch", note: `${currency} ${paid} < ${row.amount}` };
      }
      const settledAt = nowIso();
      creditRow(row, paymentId, settledAt);
      db.prepare("UPDATE payments SET status='approved', settledAt=?, providerPaymentId=?, statusDetail=? WHERE id=?")
        .run(settledAt, paymentId, String(payment.status_detail ?? ""), row.id);
      creditReferralOnPurchase(row.userId, row.id);
      return { outcome: "credited", note: `${row.kind}:${row.reference}` };
    }

    if (status === "refunded" || status === "charged_back") {
      if (row.providerPaymentId !== paymentId) {
        mark(`${paymentId}:${status}:uncredited`, "ignored");
        return { outcome: "ignored_status", note: `${status} for a payment that was never credited` };
      }
      // refunded then charged_back (or a repeat) reverses once.
      if (!mark(`${paymentId}:reversal`, "reversal")) return { outcome: "already_processed", note: row.id };
      reverseRow(row, paymentId);
      db.prepare("UPDATE payments SET status=?, reversedAt=?, statusDetail=? WHERE id=?").run(status, nowIso(), String(payment.status_detail ?? ""), row.id);
      return { outcome: "reversed", note: `${row.kind}:${row.reference}` };
    }

    if (status === "rejected" || status === "cancelled") {
      db.prepare("UPDATE payments SET status='rejected', statusDetail=? WHERE id=? AND status IN ('pending','rejected')").run(String(payment.status_detail ?? status), row.id);
      return { outcome: "rejected", note: row.id };
    }

    if (status === "pending" || status === "in_process" || status === "authorized") {
      db.prepare("UPDATE payments SET statusDetail=? WHERE id=? AND status='pending'").run(String(payment.status_detail ?? status), row.id);
      return { outcome: "pending", note: row.id };
    }
    return { outcome: "ignored_status", note: status };
  });
  return apply.immediate();
}

/**
 * How a notification's x-signature compares with MP_WEBHOOK_SECRET: "invalid" only when a signature
 * is present and wrong. Notifications sent to a preference's notification_url (and the legacy IPN
 * format) may arrive unsigned; they are accepted because the handler re-reads every payment from the
 * API with our own token, so a forged call can only make us look at a real payment's real state.
 */
export function webhookSignatureState(input: { signature: string | null; requestId: string | null; dataId: string | null }, secret = envValue("MP_WEBHOOK_SECRET")): "valid" | "unsigned" | "invalid" | "not_checked" {
  if (!secret) return "not_checked";
  if (!input.signature) return "unsigned";
  return verifyWebhookSignature(input, secret) ? "valid" : "invalid";
}

/** Strict check of one x-signature against the secret (MP's manifest format). */
export function verifyWebhookSignature(input: { signature: string | null; requestId: string | null; dataId: string | null }, secret = envValue("MP_WEBHOOK_SECRET")): boolean {
  if (!secret) return true;
  if (!input.signature || !input.dataId) return false;
  const parts = Object.fromEntries(input.signature.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(input.dataId) ? input.dataId.toLowerCase() : input.dataId;
  const manifest = `id:${id};${input.requestId ? `request-id:${input.requestId};` : ""}ts:${parts.ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  return safeEqual(expected, parts.v1);
}

export function listUserPayments(userId: string): Pick<PaymentRow, "id" | "kind" | "reference" | "period" | "amount" | "currency" | "status" | "createdAt" | "settledAt">[] {
  return getDb().prepare(
    "SELECT id, kind, reference, period, amount, currency, status, createdAt, settledAt FROM payments WHERE userId = ? AND status != 'failed' ORDER BY createdAt DESC LIMIT 50",
  ).all(userId) as PaymentRow[];
}

export function listPayments(opts: { limit?: number; status?: string; userId?: string } = {}): (PaymentRow & { email: string | null })[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.status) { where.push("p.status = ?"); args.push(opts.status); }
  if (opts.userId) { where.push("p.userId = ?"); args.push(opts.userId); }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  return getDb().prepare(
    `SELECT p.*, u.email AS email FROM payments p LEFT JOIN users u ON u.id = p.userId
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.createdAt DESC LIMIT ?`,
  ).all(...args, limit) as (PaymentRow & { email: string | null })[];
}
