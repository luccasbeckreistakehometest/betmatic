import { test, expect } from "@playwright/test";
import { loginAdmin, skipTour } from "./helpers";

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
  await expect(page.getByTestId("account")).toContainText(/admin/i);
  await page.goto("/admin");
  await expect(page.getByText("Tour concluído")).toBeVisible();
  await expect(page.getByText("Execuções do job")).toBeVisible();
});
