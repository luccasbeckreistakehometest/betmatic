import { expect, type Page } from "@playwright/test";

export async function skipTour(page: Page) {
  await page.request.post("/api/tour", { data: { completed: true, event: "e2e_skip" } });
}

export async function loginAdmin(page: Page) {
  await page.goto("/login");
  await page.getByTestId("auth-email").fill("admin@betmatic.app");
  await page.getByTestId("auth-password").fill("betmatic2026");
  await page.getByTestId("auth-submit").click();
  await expect(page).not.toHaveURL(/\/login/);
}
