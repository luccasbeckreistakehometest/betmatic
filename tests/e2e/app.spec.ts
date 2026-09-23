import { test, expect } from "@playwright/test";
import { loginAdmin, registerUser, skipTour } from "./helpers";

test("first visit offers the tour and it is saved for the anonymous cookie", async ({ page }) => {
  await page.goto("/app?sport=soccer-esp&date=20260911&lang=pt");
  await expect(page.getByTestId("tour-welcome")).toBeVisible();
  await page.getByTestId("tour-start").click();
  await expect(page.getByTestId("tour-step")).toHaveAttribute("data-step", "0");
  // one click per step; the last one is "Entendi"
  for (let i = 0; i < 12 && (await page.getByTestId("tour-step").isVisible()); i++) await page.getByTestId("tour-next").click();
  await expect(page.getByTestId("tour-step")).toBeHidden();
  const state = await page.evaluate(() => fetch("/api/tour").then((r) => r.json()));
  expect(state.tourCompleted).toBe(true);
  await page.reload();
  await page.waitForTimeout(600);
  await expect(page.getByTestId("tour-welcome")).toBeHidden();
});

test("visitors get whitelabelled tickets; the admin sees the sources", async ({ page }) => {
  await page.goto("/app");
  await skipTour(page);
  const anon = await page.request.get("/api/predictions?sport=soccer-esp&date=20260911&lang=pt").then((r) => r.json());
  expect(JSON.stringify(anon)).not.toMatch(/betano|espn/i);
  await loginAdmin(page);
  const admin = await page.request.get("/api/predictions?sport=soccer-esp&date=20260911&lang=pt").then((r) => r.json());
  expect(admin.authenticated).toBe(true);
  expect(admin.predictions.length).toBeGreaterThan(0);
  expect(admin.predictions[0].slate.suggestions.length).toBeGreaterThan(0);
  expect(JSON.stringify(admin)).toMatch(/betano/i);
});

test("admin dashboard shows the job, users and tour funnel", async ({ page }) => {
  await loginAdmin(page);
  await skipTour(page);
  await page.goto("/app");
  // The admin door is a row in the menu's Conta section, not a word loose in the header: walk the
  // way an admin actually walks, from the menu button to the dashboard.
  await page.getByTestId("menu-button").click();
  const conta = page.getByTestId("app-menu").locator('[data-menu-section="account"]');
  await conta.getByRole("link", { name: "Admin" }).click();
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByText("Tour concluído")).toBeVisible();
  await expect(page.getByText("Execuções do job")).toBeVisible();
});

test("the admin door is not in a member's menu", async ({ page }) => {
  await registerUser(page, "semadmin");
  await skipTour(page);
  await page.goto("/app");
  await page.getByTestId("menu-button").click();
  const menu = page.getByTestId("app-menu");
  await expect(menu.locator('[data-menu-section="account"]')).toBeVisible();
  await expect(menu.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
  await expect(menu.locator('[data-menu-row="/admin"]')).toHaveCount(0);
});
