import fs from "node:fs";
import path from "node:path";
import { expect, request as pwRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const MOCK_FLAG = path.join(process.cwd(), "data", "e2e", "ai-mock.on");

/** The dev server answers model calls from fixtures while this spec file runs (AI_MOCK=switch). */
export function withAiMock() {
  test.beforeAll(() => { fs.writeFileSync(MOCK_FLAG, ""); });
  test.afterAll(() => { fs.rmSync(MOCK_FLAG, { force: true }); });
}

async function adminApi() {
  const api = await pwRequest.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3300" });
  const login = await api.post("/api/auth/login", { data: { email: "admin@betmatic.app", password: "betmatic2026" } });
  expect(login.ok()).toBeTruthy();
  return api;
}

async function userIdOf(api: APIRequestContext, email: string): Promise<string> {
  const list = await api.get(`/api/admin/users?q=${encodeURIComponent(email)}`).then((r) => r.json());
  const user = (list.users ?? []).find((u: { email: string }) => u.email === email);
  expect(user, `user ${email} not found`).toBeTruthy();
  return user.id;
}

/** Sets a user's plan (and optionally coins) through the admin API, in a separate cookie jar. */
export async function setPlan(email: string, planId: string, coins = 0) {
  const api = await adminApi();
  const userId = await userIdOf(api, email);
  const res = await api.post("/api/admin/users", { data: { action: "set_plan", userId, planId, expiresAt: planId === "free" ? null : new Date(Date.now() + 30 * 86_400_000).toISOString() } });
  expect(res.ok(), await res.text()).toBeTruthy();
  if (coins) {
    const c = await api.post("/api/admin/users", { data: { action: "coins", userId, delta: coins, note: "e2e" } });
    expect(c.ok(), await c.text()).toBeTruthy();
  }
  await api.dispose();
  return userId;
}

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

/* ── The ticket card and its sheet ──────────────────────────────────────────────────────────────
 * A ticket card is a betting slip: its name, its combined price and one line per selection. Every
 * number behind it — the chance, the EV, the evidence, the measured record, "Onde apostar", the
 * alternatives — is inside the sheet the card opens, so a spec that reads any of them opens it the
 * way a reader does: by tapping the slip.
 */

/** Taps the nth ticket card and returns the open dialog (a bottom sheet on a phone). */
export async function openTicket(page: Page, index = 0): Promise<Locator> {
  await page.getByTestId("ticket-face").nth(index).click();
  const sheet = page.locator("dialog[open]");
  await expect(sheet.getByTestId("ticket-details")).toBeVisible();
  return sheet;
}

export async function closeTicket(page: Page) {
  await page.locator("dialog[open]").getByRole("button", { name: "Fechar o bilhete" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}

/**
 * The index of the first ticket whose sheet holds `selector` — the successor to the old
 * `page.locator("li", { has: … })`, now that "under the ticket" means "inside its sheet". Leaves
 * that ticket's sheet open, so the caller reads it straight away.
 */
export async function openTicketWith(page: Page, selector: string): Promise<{ index: number; sheet: Locator }> {
  const cards = page.getByTestId("ticket-face");
  const total = await cards.count();
  expect(total, "no ticket on the page").toBeGreaterThan(0);
  for (let index = 0; index < total; index += 1) {
    const sheet = await openTicket(page, index);
    if (await sheet.locator(selector).count()) return { index, sheet };
    await closeTicket(page);
  }
  throw new Error(`no ticket sheet holds ${selector}`);
}
