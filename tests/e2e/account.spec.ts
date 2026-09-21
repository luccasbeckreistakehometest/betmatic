import { test, expect } from "@playwright/test";
import { loginAs, registerUser, skipTour } from "./helpers";

test("the account page shows the plan, lets the user change the password, export and delete", async ({ page }) => {
  const { email, password } = await registerUser(page, "conta");
  await skipTour(page);
  await page.goto("/app/conta?lang=pt");
  await expect(page.getByTestId("account-page")).toContainText(email);
  await expect(page.getByTestId("account-plan")).toHaveText("Free");
  await expect(page.getByTestId("account-coins")).toHaveText("0");

  await page.getByTestId("pw-current").fill("wrong-password");
  await page.getByTestId("pw-next").fill("brandnew123");
  await page.getByTestId("pw-save").click();
  await expect(page.getByTestId("pw-msg")).toContainText("A senha atual não confere");
  await page.getByTestId("pw-current").fill(password);
  await page.getByTestId("pw-save").click();
  await expect(page.getByTestId("pw-msg")).toContainText("Senha trocada");

  const exported = await page.request.get("/api/account/export");
  expect(exported.headers()["content-disposition"]).toContain("attachment");
  const data = await exported.json();
  expect(data.profile.email).toBe(email);
  expect(JSON.stringify(data)).not.toMatch(/passwordHash|scrypt/);
  expect(data.profile.termsAcceptedAt).toBeTruthy();

  await page.getByTestId("delete-password").fill("brandnew123");
  await page.getByTestId("delete-confirm").check();
  await page.getByTestId("delete-submit").click();
  await expect(page).toHaveURL(/\/\?lang=pt/);
  expect((await page.request.post("/api/auth/login", { data: { email, password: "brandnew123" } })).status()).toBe(401);
});

test("logout is reachable from the header menu", async ({ page }) => {
  await registerUser(page, "sair");
  await skipTour(page);
  await page.goto("/app?sport=soccer-esp&date=20260911&lang=pt");
  await page.getByTestId("menu-button").click();
  await expect(page.getByTestId("app-menu")).toContainText("Minha conta");
  await page.getByTestId("logout").click();
  await expect(page).toHaveURL(/\/\?lang=pt/);
  expect((await page.request.get("/api/auth/me").then((r) => r.json())).user).toBeNull();
});

test("an admin support flow: plan with expiry and coins show up on the user's account", async ({ page, browser }) => {
  const user = await browser.newPage();
  const { email, password } = await registerUser(user, "suporte");
  const { loginAdmin } = await import("./helpers");
  await loginAdmin(page);
  await skipTour(page);
  await page.goto("/admin");
  await page.getByTestId("admin-user-search").fill(email);
  await page.getByTestId("admin-user-list").getByText(email).click();
  await expect(page.getByTestId("admin-user-detail")).toContainText(email);
  await page.getByTestId("admin-plan").selectOption("pro");
  await page.getByTestId("admin-expiry").fill("2030-01-31");
  await page.getByTestId("admin-set-plan").click();
  await expect(page.getByTestId("admin-user-detail")).toContainText("Plano pro");
  await page.getByTestId("admin-coins").fill("25");
  await page.getByTestId("admin-apply-coins").click();
  await expect(page.getByTestId("admin-user-detail")).toContainText("25 coins");
  await expect(page.getByTestId("admin-ai-spend")).toBeVisible();
  // The operator has to be able to see which provider and which models are spending the money.
  await expect(page.getByTestId("admin-ai-provider")).toContainText(/anthropic|openai/);

  await loginAs(user, email, password);
  await user.goto("/app/conta?lang=pt");
  await expect(user.getByTestId("account-plan")).toHaveText("Pro");
  await expect(user.getByTestId("account-expiry")).toContainText("2030");
  await expect(user.getByTestId("account-coins")).toHaveText("25");
  await expect(user.getByTestId("coin-history")).toContainText("Ajuste do suporte");
  await user.close();
});
