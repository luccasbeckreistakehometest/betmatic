import { test, expect } from "@playwright/test";
import { loginAdmin } from "./helpers";

test("public track record shows every ticket, and each has a shareable permalink", async ({ page }) => {
  await page.goto("/prova?lang=pt");
  const stats = page.getByTestId("proof-stats");
  await expect(stats).toContainText("3"); // generated
  await expect(stats).toContainText("50.0%"); // 1 won / 2 decided
  const list = page.getByTestId("proof-list");
  await expect(list.locator("li")).toHaveCount(3);
  await expect(list).toContainText(/ganhou/);
  await expect(list).toContainText(/perdeu/);
  await expect(list).toContainText(/pendente/);
  await list.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f]{10}/);
  await expect(page.getByTestId("ticket-page")).toContainText(/GANHOU|PERDEU|PENDENTE/);
  const share = page.getByTestId("share-wa");
  await expect(share).toHaveAttribute("href", /wa\.me\/\?text=/);
});

test("track record never names a source for visitors", async ({ page }) => {
  const html = await page.request.get("/prova?lang=pt").then((r) => r.text());
  expect(html).not.toMatch(/Betano|ESPN|DraftKings/);
});

test("free calculators work without an account", async ({ page }) => {
  await page.goto("/ferramentas?lang=pt");
  await page.getByTestId("ev-odds").fill("2.10");
  await page.getByTestId("ev-prob").fill("52");
  await expect(page.getByTestId("ev-result")).toContainText("+9.2%");
  await page.getByTestId("leg-0").fill("2.00");
  await page.getByTestId("leg-1").fill("2.00");
  await page.getByTestId("leg-2").fill("2.00");
  await expect(page.getByTestId("parlay-result")).toContainText("8.00");
  await page.getByTestId("conv-dec").fill("1.50");
  await expect(page.getByTestId("conv-result")).toContainText("-200");
});

test("bankroll: saved tickets inherit the ledger's grading; outside bets are graded by hand", async ({ page }) => {
  await loginAdmin(page);
  // a generated ticket saved with a stake
  const add = await page.request.post("/api/bankroll", { data: { kind: "ticket", gameId: "401882878", bandKey: "value", selections: ["Sevilha FC vence"], stake: 100 } });
  expect(add.ok()).toBeTruthy();
  const missing = await page.request.post("/api/bankroll", { data: { kind: "ticket", gameId: "401882878", bandKey: "value", selections: ["não existe"], stake: 10 } });
  expect(missing.status()).toBe(404);
  await page.goto("/app/bankroll?lang=pt");
  await expect(page.getByTestId("bankroll-entry")).toHaveCount(1);
  await expect(page.getByTestId("bankroll-totals")).toContainText("+R$ 100.00"); // won at 2.00 with 100
  // an outside bet, graded by the user
  await page.getByTestId("manual-title").fill("Flamengo vence @ outra casa");
  await page.getByTestId("manual-odds").fill("1.80");
  await page.getByTestId("manual-stake").fill("50");
  await page.getByTestId("manual-add").click();
  await expect(page.getByTestId("bankroll-entry")).toHaveCount(2);
  await page.getByTestId("bankroll-entry").filter({ hasText: "Flamengo" }).getByRole("button", { name: /perdeu/i }).click();
  await expect(page.getByTestId("bankroll-totals")).toContainText("+R$ 50.00"); // 100 - 50
});

test("sitemap and robots exist for search engines", async ({ page }) => {
  const sm = await page.request.get("/sitemap.xml");
  expect(sm.ok()).toBeTruthy();
  expect(await sm.text()).toContain("/prova");
  const rb = await page.request.get("/robots.txt");
  expect(await rb.text()).toContain("Disallow: /app");
});
