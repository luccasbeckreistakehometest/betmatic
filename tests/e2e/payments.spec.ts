import { test, expect } from "@playwright/test";
import { registerUser, skipTour } from "./helpers";
import { FAKE_MP } from "./fake-mercadopago";

const approve = async (pref: string, amount?: number) =>
  (await fetch(`${FAKE_MP}/__approve?pref=${pref}${amount ? `&amount=${amount}` : ""}`, { method: "POST" }).then((r) => r.json())) as { id: number };

test("plans page: period picker, BRL prices, prepaid wording", async ({ page }) => {
  await page.goto("/planos?lang=pt");
  await expect(page.getByTestId("prepaid-note")).toContainText("Não renova sozinho");
  await expect(page.getByTestId("price-pro")).toHaveText("R$ 89");
  await page.getByTestId("period-quarterly").click();
  await expect(page.getByTestId("plan-pro")).toContainText("R$ 240 total");
  await page.getByTestId("period-annual").click();
  await expect(page.getByTestId("plan-pro")).toContainText("R$ 748 total");
  await expect(page.getByTestId("buy-pro")).toHaveAttribute("href", /\/signup\?lang=pt&plan=pro&period=annual/);

  await page.goto("/planos?lang=en");
  await expect(page.getByTestId("price-pro")).toContainText("R$ 89 (BRL)");
  await page.goto("/?lang=en");
  const pricing = await page.locator("#planos").innerText();
  expect(pricing).toContain("(BRL)");
  expect(pricing).not.toMatch(/(^|[^R])\$\d/); // no bare-dollar prices for a charge made in reais
});

test("signup with a chosen plan goes straight to checkout; the webhook credits it once", async ({ page }) => {
  const email = `pagante${Date.now()}@example.com`;
  await page.goto("/signup?lang=pt&plan=pro&period=quarterly");
  await expect(page.getByTestId("auth-choice")).toContainText("Pro");
  await expect(page.getByTestId("auth-choice")).toContainText("R$ 240");
  await page.getByTestId("auth-name").fill("Pagante");
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill("password123");
  await page.getByTestId("auth-consent").check();
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("fake-mp")).toBeVisible();
  const pref = new URL(page.url()).searchParams.get("pref")!;

  // Nothing is credited by the redirect alone.
  const pending = await page.request.get("/api/account").then((r) => r.json());
  expect(pending.plan.id).toBe("free");
  expect(pending.payments[0]).toMatchObject({ kind: "plan", reference: "pro", period: "quarterly", amount: 240, status: "pending" });

  const { id } = await approve(pref);
  const hook = await page.request.post(`/api/webhooks/mercadopago?type=payment&data.id=${id}`, { data: { type: "payment", data: { id: String(id) } } });
  expect((await hook.json()).outcome).toBe("credited");
  const again = await page.request.post(`/api/webhooks/mercadopago?type=payment&data.id=${id}`, { data: {} });
  expect((await again.json()).outcome).toBe("already_processed");

  const account = await page.request.get("/api/account").then((r) => r.json());
  expect(account.plan).toMatchObject({ id: "pro", active: true });
  expect(Date.parse(account.plan.expiresAt)).toBeGreaterThan(Date.now() + 85 * 86_400_000);
  expect(account.user.coins).toBe(120);

  await page.goto(`/pagamento/sucesso?lang=pt&external_reference=bm:${account.payments[0].id}`);
  await expect(page.getByTestId("payment-row-status")).toHaveText("aprovado");
  await page.goto("/pagamento/falhou?lang=pt");
  await expect(page.getByTestId("payment-falhou")).toContainText("não foi concluído");
  await page.goto("/pagamento/pendente?lang=pt");
  await expect(page.getByTestId("payment-pendente")).toBeVisible();

  // A refund takes the plan and its coins back.
  await fetch(`${FAKE_MP}/__status?id=${id}&status=refunded`, { method: "POST" });
  expect((await (await page.request.post(`/api/webhooks/mercadopago?type=payment&data.id=${id}`, { data: {} })).json()).outcome).toBe("reversed");
  const refunded = await page.request.get("/api/account").then((r) => r.json());
  expect(refunded.plan.id).toBe("free");
  expect(refunded.user.coins).toBe(0);
});

test("a signed-in user buys coins from the plans page; a short payment is not credited", async ({ page }) => {
  await registerUser(page, "coins");
  await skipTour(page);
  await page.goto("/planos?lang=pt");
  await page.getByTestId("buy-pack_50").click();
  await expect(page.getByTestId("fake-mp")).toBeVisible();
  const pref = new URL(page.url()).searchParams.get("pref")!;
  const { id } = await approve(pref, 1);
  const hook = await page.request.post(`/api/webhooks/mercadopago?data.id=${id}`, { data: { type: "payment" } });
  expect((await hook.json()).outcome).toBe("ignored_amount_mismatch");
  expect((await page.request.get("/api/account").then((r) => r.json())).user.coins).toBe(0);
});

test("checkout guards: bad input, unknown payment ids and lookups that fail", async ({ page }) => {
  await registerUser(page, "guard");
  expect((await page.request.post("/api/billing/checkout", { data: { kind: "plan", planId: "free" } })).status()).toBe(400);
  expect((await page.request.post("/api/billing/checkout", { data: { kind: "coins", packId: "pack_999" } })).status()).toBe(400);
  expect((await page.request.post("/api/billing/checkout", { data: { kind: "plan", planId: "pro", period: "weekly" } })).status()).toBe(400);
  // MP says 404: nothing to retry.
  expect((await page.request.post("/api/webhooks/mercadopago?data.id=123456", { data: {} })).status()).toBe(404);
  // Other topics are acknowledged and ignored.
  expect((await (await page.request.post("/api/webhooks/mercadopago?type=merchant_order&id=1", { data: {} })).json()).note).toContain("ignored");
});
