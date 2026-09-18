import { test, expect } from "@playwright/test";
import { skipTour } from "./helpers";

test("the public proof page draws the equity curve and answers 'only band X'", async ({ page }) => {
  await page.goto("/prova?lang=pt");
  const chart = page.getByTestId("equity-curve");
  await expect(chart).toBeVisible();
  // seeded: value won at 2.00 (+1.00u) then mid lost (−1.00u)
  await expect(chart.getByTestId("curve-stats")).toContainText(/\b0,00\s*u/);
  await expect(chart.getByTestId("curve-stats")).toContainText(/−1,00\s*u/); // max drawdown
  await expect(chart.getByTestId("curve-path")).toHaveAttribute("d", /^M/);
  await expect(chart.getByTestId("band-row-value")).toContainText(/\+1,00\s*u/);
  await expect(chart.getByTestId("band-row-mid")).toContainText(/−1,00\s*u/);
  await chart.getByTestId("filter-band").selectOption("value");
  await expect(chart.getByTestId("curve-stats")).toContainText(/\+1,00\s*u/);
  await expect(chart.getByTestId("curve-stats")).toContainText(/\+100,0\s*%/);
  await chart.getByTestId("filter-band").selectOption("mid");
  await expect(chart.getByTestId("curve-stats")).toContainText(/−1,00\s*u/);
  await chart.getByTestId("filter-band").selectOption("");
  await chart.getByTestId("filter-evidence").selectOption("70");
  await expect(chart.getByTestId("curve-stats")).toContainText(/\+1,00\s*u/); // only the 78-evidence ticket qualifies
  await chart.getByTestId("filter-kind").selectOption("parlay");
  await expect(chart.getByTestId("curve-empty")).toBeVisible();
  // a point links to the ticket's permalink
  await chart.getByTestId("filter-kind").selectOption("");
  await chart.getByTestId("filter-evidence").selectOption("0");
  const href = await chart.locator("svg a").first().getAttribute("href");
  expect(href).toMatch(/^\/p\/[0-9a-f]{10}\?lang=pt$/);
  const rows = await page.request.get("/api/public/backtest").then((r) => r.json());
  expect(rows.rows).toHaveLength(3);
  expect(JSON.stringify(rows)).not.toMatch(/Sevilha|Betano|ESPN/); // no text leaves the server
});

test("the bankroll page carries the ledger curve and the user's own money curve", async ({ page }) => {
  // a fresh account, so the admin's bankroll (asserted by proof.spec) stays untouched
  const reg = await page.request.post("/api/auth/register", { data: { name: "Curva", email: `curva${Date.now()}@example.com`, password: "password123", lang: "pt", acceptTerms: true } });
  expect(reg.ok()).toBeTruthy();
  await skipTour(page);
  for (const [title, outcome] of [["Aposta 1", "won"], ["Aposta 2", "lost"]] as const) {
    const r = await page.request.post("/api/bankroll", { data: { kind: "manual", title, odds: 2, stake: 10 } });
    const { entry } = await r.json();
    await page.request.patch("/api/bankroll", { data: { id: entry.id, outcome } });
  }
  await page.goto("/app/bankroll?lang=pt");
  await expect(page.getByTestId("equity-curve")).toBeVisible();
  await expect(page.getByTestId("equity-curve").getByTestId("curve-path")).toHaveAttribute("d", /^M/);
  await expect(page.getByTestId("own-curve")).toBeVisible();
});
