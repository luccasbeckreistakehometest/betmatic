import { test, expect } from "@playwright/test";
import { registerUser, setPlan, skipTour, withAiMock } from "./helpers";

withAiMock();

test("custom parlay: an unreachable target refunds, a reachable one charges and saves to the bankroll", async ({ page }) => {
  const { email } = await registerUser(page, "custom");
  await setPlan(email, "pro", 50);
  await skipTour(page);
  await page.goto("/app/parlays/custom?sport=wnba&lang=pt");
  await expect(page.getByTestId("custom-build")).toContainText("12 coins");

  // Measured legs only, one per game, three games today: 20x is out of reach.
  await page.getByTestId("preset-20").click();
  await page.getByTestId("custom-build").click();
  await expect(page.getByTestId("custom-unreachable")).toContainText("Não dá para chegar em 20x");
  await expect(page.getByTestId("custom-unreachable")).toContainText("Os coins voltaram");
  expect((await page.request.get("/api/auth/me").then((r) => r.json())).user.coins).toBe(50);

  await page.getByTestId("target-input").fill("7");
  await page.getByTestId("custom-build").click();
  const tickets = page.getByTestId("custom-ticket");
  await expect(tickets.first()).toBeVisible({ timeout: 60_000 });
  expect(await tickets.count()).toBeLessThanOrEqual(3);
  await expect(page.getByTestId("custom-results")).toContainText("gastou 12 coins");
  expect((await page.request.get("/api/auth/me").then((r) => r.json())).user.coins).toBe(38);

  await tickets.first().getByTestId("custom-stake").fill("10");
  await tickets.first().getByTestId("custom-save").click();
  await expect(tickets.first().getByTestId("custom-saved")).toBeVisible();
  const bank = await page.request.get("/api/bankroll").then((r) => r.json());
  const entry = bank.entries.find((e: { source: string }) => e.source === "custom");
  expect(entry.legs.length).toBe(3);
  expect(entry.autoLegs).toBe(3);
});
