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
