import { test, expect } from "@playwright/test";
import { loginAdmin } from "./helpers";

test("a referral link is remembered at signup; coins wait for the first paid purchase", async ({ page, context }) => {
  await loginAdmin(page);
  const me = await page.request.get("/api/referral").then((r) => r.json());
  expect(me.code).toHaveLength(8);
  const adminBefore = (await page.request.get("/api/auth/me").then((r) => r.json())).user.coins;
  const invitedBefore = me.invited;
  await context.clearCookies();

  await page.goto(`/r/${me.code}?lang=pt`);
  await expect(page).toHaveURL(/\/signup/);
  const reg = await page.request.post("/api/auth/register", { data: { name: "Nova", email: `nova${Date.now()}@example.com`, password: "password123", lang: "pt", acceptTerms: true } });
  expect(reg.ok()).toBeTruthy();
  const nova = await page.request.get("/api/auth/me").then((r) => r.json());
  expect(nova.user.coins).toBe(0); // a signup costs nothing to fake, so it pays nothing

  await context.clearCookies();
  await loginAdmin(page);
  const after = await page.request.get("/api/referral").then((r) => r.json());
  expect(after.invited).toBe(invitedBefore + 1);
  expect((await page.request.get("/api/auth/me").then((r) => r.json())).user.coins).toBe(adminBefore);
  await page.goto("/app/referral?lang=pt");
  await expect(page.getByTestId("referral-link")).toContainText(me.code);
});
