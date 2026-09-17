import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";

const DIR = path.join(process.cwd(), "data", "unit-payments");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
process.env.MP_ACCESS_TOKEN = "TEST-token";
process.env.APP_URL = "https://betmatic.example";
fs.rmSync(DIR, { recursive: true, force: true });

const mp = await import("@/lib/server/mercadopago");
const { createUser, findById } = await import("@/lib/server/users");
const { getDb } = await import("@/lib/server/db");
const { recordReferral, refCodeFor } = await import("@/lib/server/referral");

type Json = Record<string, unknown>;
const payments = new Map<string, Json>();
const calls: { path: string; body: Json | null }[] = [];
let lookupFails = false;
let prefCounter = 0;

mp.setMercadoPagoFetcher(async (p, init) => {
  const body = init?.body ? (JSON.parse(String(init.body)) as Json) : null;
  calls.push({ path: p, body });
  if (p === "/checkout/preferences") {
    prefCounter += 1;
    return { id: `pref-${prefCounter}`, init_point: `https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-${prefCounter}` };
  }
  if (lookupFails) throw new mp.MercadoPagoError("Mercado Pago 500", 500);
  const id = p.split("/").pop()!;
  const found = payments.get(id);
  if (!found) throw new mp.MercadoPagoError("not found", 404);
  return found;
});
afterAll(() => mp.setMercadoPagoFetcher(null));

const buyer = await createUser({ email: "buyer@x.com", name: "Buyer", password: "password123" });
const friend = await createUser({ email: "friend@x.com", name: "Friend", password: "password123" });

function lastPreference(): Json {
  return [...calls].reverse().find((c) => c.path === "/checkout/preferences")!.body!;
}

beforeEach(() => {
  lookupFails = false;
});

describe("checkout", () => {
  it("builds absolute return and webhook URLs from APP_URL, in BRL, keyed by our row id", async () => {
    const out = await mp.createCoinCheckout(buyer.id, "pack_50", buyer.email);
    expect(out.url).toMatch(/^https:\/\/www\.mercadopago\.com\.br\//);
    const pref = lastPreference();
    expect(pref.notification_url).toBe("https://betmatic.example/api/webhooks/mercadopago");
    expect(pref.back_urls).toEqual({
      success: "https://betmatic.example/pagamento/sucesso",
      failure: "https://betmatic.example/pagamento/falhou",
      pending: "https://betmatic.example/pagamento/pendente",
    });
    expect((pref.items as Json[])[0].currency_id).toBe("BRL");
    expect(pref.external_reference).toBe(`bm:${out.paymentId}`);
  });

  it("refuses to build links to localhost when no base URL is configured", async () => {
    const saved = process.env.APP_URL;
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
    await expect(mp.createCoinCheckout(buyer.id, "pack_50")).rejects.toThrow(/APP_URL/);
    process.env.APP_URL = saved;
  });

  it("rejects unknown plans, the free plan and unknown packs", async () => {
    await expect(mp.createPlanCheckout(buyer.id, "free", "monthly")).rejects.toBeInstanceOf(RangeError);
    await expect(mp.createPlanCheckout(buyer.id, "gold", "monthly")).rejects.toBeInstanceOf(RangeError);
    await expect(mp.createCoinCheckout(buyer.id, "pack_x")).rejects.toBeInstanceOf(RangeError);
  });

  it("prices longer periods with the published discount", async () => {
    const out = await mp.createPlanCheckout(buyer.id, "pro", "quarterly");
    const row = getDb().prepare("SELECT amount, period FROM payments WHERE id = ?").get(out.paymentId) as { amount: number; period: string };
    expect(row).toEqual({ amount: 240, period: "quarterly" }); // 89 × 3 × 0.9 = 240.3 → 240
  });
});

describe("webhook", () => {
  it("credits an approved payment once, even when delivered twice", async () => {
    const out = await mp.createCoinCheckout(buyer.id, "pack_200");
    payments.set("1001", { id: 1001, status: "approved", external_reference: `bm:${out.paymentId}`, transaction_amount: 59, currency_id: "BRL" });
    const before = findById(buyer.id)!.coins;
    const [a, b] = await Promise.all([mp.handleWebhook("1001"), mp.handleWebhook("1001")]);
    expect([a.outcome, b.outcome].sort()).toEqual(["already_processed", "credited"]);
    expect(findById(buyer.id)!.coins - before).toBe(230);
    expect((await mp.handleWebhook("1001")).outcome).toBe("already_processed");
    expect(findById(buyer.id)!.coins - before).toBe(230);
  });

  it("credits only the row named in external_reference, not every pending row", async () => {
    const first = await mp.createCoinCheckout(buyer.id, "pack_50");
    const second = await mp.createCoinCheckout(buyer.id, "pack_50");
    payments.set("1002", { id: 1002, status: "approved", external_reference: `bm:${second.paymentId}`, transaction_amount: 19, currency_id: "BRL" });
    expect((await mp.handleWebhook("1002")).outcome).toBe("credited");
    const status = (id: string) => (getDb().prepare("SELECT status FROM payments WHERE id = ?").get(id) as { status: string }).status;
    expect(status(first.paymentId)).toBe("pending");
    expect(status(second.paymentId)).toBe("approved");
  });

  it("ignores references it did not issue and amounts below the price", async () => {
    payments.set("1003", { id: 1003, status: "approved", external_reference: `coins|${buyer.id}|pack_600`, transaction_amount: 149 });
    expect((await mp.handleWebhook("1003")).outcome).toBe("ignored_unknown_reference");
    const out = await mp.createCoinCheckout(buyer.id, "pack_600");
    payments.set("1004", { id: 1004, status: "approved", external_reference: `bm:${out.paymentId}`, transaction_amount: 1, currency_id: "BRL" });
    const before = findById(buyer.id)!.coins;
    expect((await mp.handleWebhook("1004")).outcome).toBe("ignored_amount_mismatch");
    expect(findById(buyer.id)!.coins).toBe(before);
  });

  it("throws when the lookup fails so the route answers 5xx and Mercado Pago retries", async () => {
    lookupFails = true;
    await expect(mp.handleWebhook("1005")).rejects.toBeInstanceOf(mp.MercadoPagoError);
  });

  it("a rejected payment closes nothing it should not; a later approval still credits", async () => {
    const out = await mp.createPlanCheckout(buyer.id, "starter", "monthly");
    payments.set("1006", { id: 1006, status: "rejected", status_detail: "cc_rejected_insufficient_amount", external_reference: `bm:${out.paymentId}`, transaction_amount: 39 });
    expect((await mp.handleWebhook("1006")).outcome).toBe("rejected");
    payments.set("1007", { id: 1007, status: "approved", external_reference: `bm:${out.paymentId}`, transaction_amount: 39, currency_id: "BRL" });
    expect((await mp.handleWebhook("1007")).outcome).toBe("credited");
    const user = findById(buyer.id)!;
    expect(user.planId).toBe("starter");
    expect(Date.parse(user.planExpiresAt!)).toBeGreaterThan(Date.now() + 27 * 86_400_000);
  });

  it("a refund reverses the plan time and the coins it granted, once", async () => {
    const out = await mp.createPlanCheckout(friend.id, "pro", "monthly");
    payments.set("1008", { id: 1008, status: "approved", external_reference: `bm:${out.paymentId}`, transaction_amount: 89, currency_id: "BRL" });
    await mp.handleWebhook("1008");
    expect(findById(friend.id)!.planId).toBe("pro");
    expect(findById(friend.id)!.coins).toBe(120);
    payments.set("1008", { ...payments.get("1008")!, status: "refunded" });
    expect((await mp.handleWebhook("1008")).outcome).toBe("reversed");
    expect((await mp.handleWebhook("1008")).outcome).toBe("already_processed");
    const after = findById(friend.id)!;
    expect(after.planId).toBe("free");
    expect(after.coins).toBe(0);
  });

  it("the first paid purchase pays the referral", async () => {
    const invited = await createUser({ email: "invited@x.com", name: "Invited", password: "password123" });
    recordReferral(invited.id, refCodeFor(buyer.id));
    const before = findById(buyer.id)!.coins;
    const out = await mp.createCoinCheckout(invited.id, "pack_50");
    payments.set("1009", { id: 1009, status: "approved", external_reference: `bm:${out.paymentId}`, transaction_amount: 19, currency_id: "BRL" });
    await mp.handleWebhook("1009");
    expect(findById(invited.id)!.coins).toBe(50 + 5);
    expect(findById(buyer.id)!.coins - before).toBe(5);
  });
});

describe("refunds after switching plans", () => {
  const DAY = 86_400_000;
  let seq = 3000;
  const daysLeft = (userId: string) => (Date.parse(findById(userId)!.planExpiresAt!) - Date.now()) / DAY;
  async function buy(userId: string, planId: string, period: "monthly" | "annual"): Promise<string> {
    const out = await mp.createPlanCheckout(userId, planId, period);
    const amount = (getDb().prepare("SELECT amount FROM payments WHERE id = ?").get(out.paymentId) as { amount: number }).amount;
    const id = String(++seq);
    payments.set(id, { id: Number(id), status: "approved", external_reference: `bm:${out.paymentId}`, transaction_amount: amount, currency_id: "BRL" });
    expect((await mp.handleWebhook(id)).outcome).toBe("credited");
    return id;
  }
  async function refund(id: string, status = "refunded") {
    payments.set(id, { ...payments.get(id)!, status });
    expect((await mp.handleWebhook(id)).outcome).toBe("reversed");
  }

  it("refunding the first plan takes back the days that were converted into the second", async () => {
    const u = await createUser({ email: "switch1@x.com", name: "S1", password: "password123" });
    const starter = await buy(u.id, "starter", "annual");
    await buy(u.id, "max", "monthly");
    expect(findById(u.id)!.planId).toBe("max");
    expect(daysLeft(u.id)).toBeGreaterThan(95); // a year of Starter converted at 39/199, plus a month
    await refund(starter);
    expect(findById(u.id)!.planId).toBe("max");
    expect(daysLeft(u.id)).toBeGreaterThan(27);
    expect(daysLeft(u.id)).toBeLessThan(32); // only the Max month that was paid for
  });

  it("a chargeback on an annual Max never leaves years of a cheaper plan behind", async () => {
    const u = await createUser({ email: "switch2@x.com", name: "S2", password: "password123" });
    const max = await buy(u.id, "max", "annual");
    await buy(u.id, "starter", "monthly");
    expect(daysLeft(u.id)).toBeGreaterThan(1000);
    await refund(max, "charged_back");
    expect(findById(u.id)!.planId).toBe("starter");
    expect(daysLeft(u.id)).toBeLessThan(32);
  });

  it("refunding the newer plan puts the older one back as it was", async () => {
    const u = await createUser({ email: "switch3@x.com", name: "S3", password: "password123" });
    await buy(u.id, "starter", "annual");
    const annualExpiry = findById(u.id)!.planExpiresAt;
    const max = await buy(u.id, "max", "monthly");
    await refund(max);
    expect(findById(u.id)!.planId).toBe("starter");
    expect(findById(u.id)!.planExpiresAt).toBe(annualExpiry);
  });

  it("refunding the only plan purchase returns the account to free", async () => {
    const u = await createUser({ email: "switch4@x.com", name: "S4", password: "password123" });
    const pro = await buy(u.id, "pro", "monthly");
    await refund(pro);
    expect(findById(u.id)).toMatchObject({ planId: "free", planExpiresAt: null });
  });

  it("does not guess when an admin changed the plan after the purchase", async () => {
    const { setPlanByAdmin } = await import("@/lib/server/users");
    const u = await createUser({ email: "switch5@x.com", name: "S5", password: "password123" });
    const pro = await buy(u.id, "pro", "monthly");
    setPlanByAdmin(u.id, "max", "2030-01-01T00:00:00.000Z");
    await refund(pro);
    expect(findById(u.id)).toMatchObject({ planId: "max", planExpiresAt: "2030-01-01T00:00:00.000Z" });
    const ops = getDb().prepare("SELECT meta FROM ops_log WHERE scope = 'payments.reversal'").all() as { meta: string }[];
    expect(ops.some((o) => o.meta.includes(u.id))).toBe(true);
  });

  it("a refund takes back the referral coins that purchase paid, on both sides", async () => {
    const referrer = await createUser({ email: "refowner@x.com", name: "Owner", password: "password123" });
    const invited = await createUser({ email: "refbuyer@x.com", name: "Buyer", password: "password123" });
    recordReferral(invited.id, refCodeFor(referrer.id));
    const out = await mp.createCoinCheckout(invited.id, "pack_50");
    payments.set("3900", { id: 3900, status: "approved", external_reference: `bm:${out.paymentId}`, transaction_amount: 19, currency_id: "BRL" });
    await mp.handleWebhook("3900");
    expect(findById(referrer.id)!.coins).toBe(5);
    await refund("3900");
    expect(findById(referrer.id)!.coins).toBe(0);
    expect(findById(invited.id)!.coins).toBe(0);
    expect((getDb().prepare("SELECT status FROM referrals WHERE referredId = ?").get(invited.id) as { status: string }).status).toBe("reversed");
  });

  it("a second approved payment on a paid checkout is not credited and is flagged for refund", async () => {
    const u = await createUser({ email: "dupe@x.com", name: "Dupe", password: "password123" });
    const out = await mp.createCoinCheckout(u.id, "pack_50");
    payments.set("3950", { id: 3950, status: "approved", external_reference: `bm:${out.paymentId}`, transaction_amount: 19, currency_id: "BRL" });
    payments.set("3951", { id: 3951, status: "approved", external_reference: `bm:${out.paymentId}`, transaction_amount: 19, currency_id: "BRL" });
    expect((await mp.handleWebhook("3950")).outcome).toBe("credited");
    expect((await mp.handleWebhook("3951")).outcome).toBe("already_processed");
    expect(findById(u.id)!.coins).toBe(50);
    const ops = getDb().prepare("SELECT message FROM ops_log WHERE scope = 'payments.duplicate'").all() as { message: string }[];
    expect(ops.some((o) => o.message.includes("3951"))).toBe(true);
    const row = getDb().prepare("SELECT statusDetail FROM payments WHERE id = ?").get(out.paymentId) as { statusDetail: string };
    expect(row.statusDetail).toMatch(/duplicate payment 3951/);
  });
});

describe("webhook signature", () => {
  it("accepts a correct x-signature and rejects anything else when a secret is set", () => {
    const secret = "whsec";
    const ts = "1700000000";
    const v1 = createHmac("sha256", secret).update(`id:123;request-id:abc;ts:${ts};`).digest("hex");
    expect(mp.verifyWebhookSignature({ signature: `ts=${ts},v1=${v1}`, requestId: "abc", dataId: "123" }, secret)).toBe(true);
    expect(mp.verifyWebhookSignature({ signature: `ts=${ts},v1=${v1}`, requestId: "abc", dataId: "124" }, secret)).toBe(false);
    expect(mp.verifyWebhookSignature({ signature: null, requestId: "abc", dataId: "123" }, secret)).toBe(false);
    expect(mp.verifyWebhookSignature({ signature: null, requestId: null, dataId: null }, "")).toBe(true);
  });
});

describe("plan expiry on purchase", () => {
  it("extends the same plan, converts time left when switching, starts fresh when lapsed", async () => {
    const { nextPlanExpiry } = await import("@/lib/server/users");
    const now = new Date("2026-09-17T12:00:00Z");
    const in30 = new Date(now.getTime() + 30 * 86_400_000).toISOString();
    expect(nextPlanExpiry({ planId: "pro", planExpiresAt: in30 }, "pro", "monthly", now).toISOString()).toBe("2026-11-17T12:00:00.000Z");
    // 30 days of Pro (89) are worth 13.4 days of Max (199), then one month is added.
    const switched = nextPlanExpiry({ planId: "pro", planExpiresAt: in30 }, "max", "monthly", now);
    const days = (switched.getTime() - now.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(30 + 13);
    expect(days).toBeLessThan(31 + 14);
    const lapsed = nextPlanExpiry({ planId: "pro", planExpiresAt: "2026-01-01T00:00:00Z" }, "pro", "quarterly", now);
    expect(lapsed.toISOString()).toBe("2026-12-17T12:00:00.000Z");
  });
});
