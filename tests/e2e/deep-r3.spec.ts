import path from "node:path";
import Database from "better-sqlite3";
import { test, expect, type Page } from "@playwright/test";
import { registerUser, setPlan, skipTour, withAiMock } from "./helpers";

withAiMock();

const DB = path.join(process.cwd(), "data", "e2e", "betmatic.db");
const coins = async (page: Page) => (await page.request.get("/api/auth/me").then((r) => r.json())).user.coins as number;

async function fillSlip(page: Page) {
  await page.getByLabel("Seleção 1").fill("Ana Lima mais de 17,5 pontos");
  await page.getByLabel("Odds 1").fill("1.87");
  await page.getByLabel("Seleção 2").fill("Bia Souza mais de 6,5 rebotes");
  await page.getByLabel("Odds 2").fill("1.80");
}

test("deep slip analysis: Max pays the normal price and sees every leg checked; Pro sees the 14-coin option", async ({ page, browser }) => {
  const { email } = await registerUser(page, "max");
  await setPlan(email, "max", 20);
  await skipTour(page);
  await page.goto("/app/slip?sport=wnba&lang=pt");
  await expect(page.getByTestId("deep-toggle")).toContainText("incluída no Max: 8 coins");
  await expect(page.getByTestId("deep-toggle").locator("input")).toBeChecked();
  await fillSlip(page);
  await page.getByRole("button", { name: "Analisar bilhete" }).click();
  const table = page.getByTestId("deep-table");
  await expect(table).toBeVisible({ timeout: 60_000 });
  await expect(table.getByTestId("deep-leg")).toHaveCount(2);
  await expect(table.getByTestId("deep-measured").first()).toContainText("L5");
  await expect(page.getByTestId("deep-flags")).toContainText("Linhas 1 e 2");
  await expect(page.getByText("Análise de teste")).toBeVisible();
  expect(await coins(page)).toBe(12);

  const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3300", locale: "pt-BR" });
  const pro = await ctx.newPage();
  const other = await registerUser(pro, "prodeep");
  await setPlan(other.email, "pro", 20);
  await skipTour(pro);
  await pro.goto("/app/slip?sport=wnba&lang=pt");
  await expect(pro.getByTestId("deep-toggle")).toContainText("(14 coins)");
  await expect(pro.getByTestId("slip-price")).toContainText("8 coins");
  await pro.getByTestId("deep-toggle").locator("input").check();
  await expect(pro.getByTestId("slip-price")).toContainText("14 coins");
  await fillSlip(pro);
  await pro.getByRole("button", { name: "Analisar bilhete" }).click();
  await expect(pro.getByTestId("deep-table")).toBeVisible({ timeout: 60_000 });
  expect(await coins(pro)).toBe(6);
  await ctx.close();
});

test("Max refresh: hidden while nothing changed, offered once a lineup alert lands, used once", async ({ page }) => {
  const { email } = await registerUser(page, "maxref");
  await setPlan(email, "max");
  await skipTour(page);
  const game = "/app/game/990000103?sport=wnba&lang=pt";
  await page.goto(game);
  await expect(page.getByTestId("ticket-bankroll").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("refresh-bar")).toHaveCount(0);

  const db = new Database(DB);
  db.prepare("INSERT OR IGNORE INTO leg_alerts (ledgerId, legIndex, gameId, sportKey, kind, player, detail, detectedAt) VALUES (?,?,?,?,?,?,?,?)")
    .run("e2e-refresh", 0, "990000103", "wnba", "out", "Iara Costa", "Out", new Date(Date.now() + 1000).toISOString());
  db.close();
  await page.waitForTimeout(1100);
  await page.reload();
  await expect(page.getByTestId("refresh-bar")).toContainText("A escalação mexeu");
  await page.getByTestId("refresh-tickets").click();
  await expect(page.getByTestId("refresh-done")).toBeVisible({ timeout: 60_000 });

  const read = new Database(DB, { readonly: true });
  const n = (read.prepare("SELECT COUNT(*) n FROM generation_requests WHERE scope='refresh' AND gameId='990000103'").get() as { n: number }).n;
  read.close();
  expect(n).toBe(1);
  await page.reload();
  await expect(page.getByTestId("ticket-bankroll").first()).toBeVisible();
  await expect(page.getByTestId("refresh-bar")).toHaveCount(0);
});
