import path from "node:path";
import Database from "better-sqlite3";
import { test, expect, type Page } from "@playwright/test";
import { registerUser, setPlan, skipTour, withAiMock } from "./helpers";

withAiMock();

const GAME = "/app/game/990000102?sport=wnba&lang=pt";
const DB = path.join(process.cwd(), "data", "e2e", "betmatic.db");
const count = (sql: string) => {
  const db = new Database(DB, { readonly: true });
  try { return (db.prepare(sql).get() as { n: number }).n; } finally { db.close(); }
};
const setVisibility = (page: Page, state: "hidden" | "visible") => page.evaluate((s) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
  document.dispatchEvent(new Event("visibilitychange"));
}, state);

test("live panel: legs tracked with the chance now, polling only while visible, one shared live read that never alerts", async ({ page, browser }) => {
  const { email } = await registerUser(page, "live");
  await setPlan(email, "pro");
  await skipTour(page);
  let polls = 0;
  page.on("request", (r) => { if (r.method() === "GET" && r.url().includes("/api/game/990000102/live")) polls += 1; });

  await page.goto(GAME);
  const panel = page.getByTestId("live-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("live-caution")).toContainText("Aposte só o que não faz falta");
  // The tickets on a game under way were priced before it started; the panel has to say so.
  await expect(page.getByTestId("live-pregame")).toContainText("antes de o jogo começar");
  await expect(page.getByTestId("live-score")).toContainText("DUN 61 × 58 CED");
  const tickets = panel.getByTestId("live-ticket");
  await expect(tickets).toHaveCount(3);
  await expect(tickets.filter({ hasText: "Dupla que já bateu" }).getByTestId("live-chance")).toContainText(/chance agora 100\s*%/);
  await expect(tickets.filter({ hasText: "Hana abaixo" }).getByTestId("live-chip")).toHaveText("caiu");
  const gabi = tickets.filter({ hasText: "Gabi decide" });
  await expect(gabi.getByTestId("live-chip").first()).toContainText(/vivo \d+\s*%/);
  await expect(gabi.getByTestId("live-foul")).toBeVisible();

  // Polls while visible, stops while hidden, resumes on return.
  await expect.poll(() => polls, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
  await setVisibility(page, "hidden");
  await page.waitForTimeout(500);
  const frozen = polls;
  await page.waitForTimeout(4000);
  expect(polls).toBe(frozen);
  await setVisibility(page, "visible");
  await expect.poll(() => polls, { timeout: 5000 }).toBeGreaterThan(frozen);

  // The live read: once, then served from the shared cache; no alert is written.
  const alertsBefore = count("SELECT COUNT(*) n FROM alert_log");
  await page.getByTestId("live-read-btn").click();
  await expect(page.getByTestId("live-read-ticket").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("live-read")).toContainText("Nova leitura liberada");
  const second = await page.evaluate(async () => {
    const res = await fetch(document.querySelector("[data-live-url]")?.getAttribute("data-live-url") ?? "", { method: "POST" });
    return { status: res.status, body: await res.json() };
  });
  expect(second.status).toBe(200);
  expect(second.body.cached).toBe(true);
  expect(count("SELECT COUNT(*) n FROM generation_requests WHERE scope='live'")).toBe(1);
  expect(count("SELECT COUNT(*) n FROM alert_log")).toBe(alertsBefore);

  // A free account follows the legs but gets no live read button.
  const ctx = await browser.newContext({ baseURL: "http://localhost:3300", locale: "pt-BR" });
  const free = await ctx.newPage();
  await registerUser(free, "livefree");
  await skipTour(free);
  await free.goto(GAME);
  await expect(free.getByTestId("live-panel")).toBeVisible({ timeout: 30_000 });
  await expect(free.getByTestId("live-read-plan")).toContainText("Pro e Max");
  await expect(free.getByTestId("live-read-btn")).toHaveCount(0);
  // ...and never the read the Pro reader paid for, on the page or through the API.
  await expect(free.getByTestId("live-read-ticket")).toHaveCount(0);
  const api = await free.evaluate(async () => (await fetch(document.querySelector("[data-live-url]")?.getAttribute("data-live-url") ?? "")).json());
  expect(api.canRead).toBe(false);
  expect(api.read).toBeNull();
  expect(api.nextReadAt).toBeNull();
  await ctx.close();
});
