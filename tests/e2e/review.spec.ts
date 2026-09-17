import { test, expect } from "@playwright/test";
import { loginAdmin, skipTour } from "./helpers";

const LOST = { gameId: "401882878", bandKey: "mid", selections: ["Mais de 2,5 gols", "Ambas marcam"] };

test("'Por que perdi?' on a lost ticket: legs with actuals when no model key is set, gated to owner or admin", async ({ page, request }) => {
  await loginAdmin(page);
  await skipTour(page);
  const add = await page.request.post("/api/bankroll", { data: { kind: "ticket", ...LOST, stake: 20 } });
  expect(add.ok()).toBeTruthy();
  const { entry } = await add.json();
  expect(entry.slug).toMatch(/^[0-9a-f]{10}$/);

  // bankroll: the button sits under the lost ticket only
  await page.goto("/app/bankroll?lang=pt");
  const row = page.getByTestId("bankroll-entry").filter({ hasText: "Jogo aberto" });
  await row.getByTestId("why-lost").click();
  const review = row.getByTestId("loss-review");
  await expect(review).toBeVisible();
  await expect(review.getByTestId("review-fallback")).toBeVisible(); // no ANTHROPIC key in e2e
  await expect(review.getByTestId("review-legs")).toContainText("✗ Mais de 2,5 gols");
  await expect(review.getByTestId("review-legs")).toContainText("real: total 2 vs line 2.5");
  await expect(review.getByTestId("review-legs")).toContainText("✓ Ambas marcam");

  // the permalink shows it to the admin too, and never to a visitor
  await page.goto(`/p/${entry.slug}?lang=pt`);
  await expect(page.getByTestId("ticket-review").getByTestId("why-lost")).toBeVisible();
  const anon = await request.get(`/p/${entry.slug}?lang=pt`).then((r) => r.text());
  expect(anon).not.toContain("Por que perdi?");
  expect((await request.post("/api/review", { data: { slug: entry.slug } })).status()).toBe(401);

  // a won ticket has nothing to explain
  const wonSlug = (await page.request.get("/api/public/backtest").then((r) => r.json())).rows.find((r: { outcome: string }) => r.outcome === "won").id;
  expect((await page.request.post("/api/review", { data: { slug: wonSlug } })).status()).toBe(400);
  expect((await page.request.post("/api/review", { data: { slug: "0000000000" } })).status()).toBe(404);

  // another user without the ticket in their bankroll is refused
  await page.context().clearCookies();
  await page.request.post("/api/auth/register", { data: { name: "Outro", email: `outro${Date.now()}@example.com`, password: "password123", lang: "pt" } });
  expect((await page.request.post("/api/review", { data: { slug: entry.slug } })).status()).toBe(403);
  const addMine = await page.request.post("/api/bankroll", { data: { kind: "ticket", ...LOST, stake: 5 } });
  expect(addMine.ok()).toBeTruthy();
  const mine = await page.request.post("/api/review", { data: { slug: entry.slug } }).then((r) => r.json());
  expect(mine.available).toBe(false);
  expect(mine.legs.join("\n")).not.toMatch(/Betano|ESPN/);
});
