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

let counter = 0;
/** A fresh free account, signed in on this page's context. */
export async function registerUser(page: Page, prefix = "user"): Promise<{ email: string; password: string }> {
  const email = `${prefix}${Date.now()}${++counter}@example.com`;
  const password = "password123";
  const r = await page.request.post("/api/auth/register", { data: { name: prefix, email, password, lang: "pt", acceptTerms: true } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return { email, password };
}

export async function loginAs(page: Page, email: string, password: string) {
  const r = await page.request.post("/api/auth/login", { data: { email, password } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
