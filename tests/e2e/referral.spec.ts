import { test, expect } from "@playwright/test";
import { loginAdmin } from "./helpers";

test("a referral link credits both the inviter and the new account", async ({ page, context }) => {
  await loginAdmin(page);
  const me = await page.request.get("/api/referral").then((r) => r.json());
  expect(me.code).toHaveLength(8);
  const adminBefore = (await page.request.get("/api/auth/me").then((r) => r.json())).user.coins;
  await context.clearCookies();

  await page.goto(`/r/${me.code}?lang=pt`);
  await expect(page).toHaveURL(/\/signup/);
  const reg = await page.request.post("/api/auth/register", { data: { name: "Nova", email: `nova${Date.now()}@example.com`, password: "password123", lang: "pt" } });
  expect(reg.ok()).toBeTruthy();
  const nova = await page.request.get("/api/auth/me").then((r) => r.json());
  expect(nova.user.coins).toBe(5);

  await context.clearCookies();
  await loginAdmin(page);
  const adminAfter = (await page.request.get("/api/auth/me").then((r) => r.json())).user.coins;
  expect(adminAfter - adminBefore).toBe(5);
  await page.goto("/app/referral?lang=pt");
  await expect(page.getByTestId("referral-link")).toContainText(me.code);
});
