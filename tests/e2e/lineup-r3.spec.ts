import { request as pwRequest, test, expect, type Page } from "@playwright/test";
import { registerUser, setPlan, skipTour, withAiMock } from "./helpers";

withAiMock();

const GAME = "/app/game/990000201?sport=soccer-bra&lang=pt";

async function runLineups() {
  const api = await pwRequest.newContext({ baseURL: "http://localhost:3300" });
  expect((await api.post("/api/auth/login", { data: { email: "admin@betmatic.app", password: "betmatic2026" } })).ok()).toBeTruthy();
  const r = await api.post("/api/cron/refresh?job=lineups");
  expect(r.ok(), await r.text()).toBeTruthy();
  const body = await r.json();
  await api.dispose();
  return body as { games: number; alerts: number; notified: number };
}

async function saveMainTicket(page: Page) {
  await page.goto(GAME);
  const main = page.locator("li", { has: page.getByTestId("alternatives") }).first();
  await expect(main).toBeVisible({ timeout: 60_000 });
  await main.getByTestId("ticket-stake").fill("10");
  await main.getByTestId("ticket-add").click();
  await expect(main.getByText("✓")).toBeVisible();
}

test("lineup watcher: a benched player flags the leg, the backup without him, the bankroll entry, and alerts savers once", async ({ page, browser }) => {
  const { email } = await registerUser(page, "lineup");
  await setPlan(email, "pro");
  await skipTour(page);
  await saveMainTicket(page);

  // A second saver who then pauses: nothing reaches them.
  const ctx = await browser.newContext({ baseURL: "http://localhost:3300", locale: "pt-BR" });
  const paused = await ctx.newPage();
  const other = await registerUser(paused, "lineuppaused");
  await setPlan(other.email, "pro");
  await skipTour(paused);
  await saveMainTicket(paused);
  expect((await paused.request.post("/api/settings/pause", { data: { days: 7 } })).ok()).toBeTruthy();

  const first = await runLineups();
  expect(first.alerts).toBeGreaterThan(0);

  await page.goto(GAME);
  await expect(page.getByTestId("lineup-banner")).toContainText("Téo Lins começa no banco", { timeout: 30_000 });
  await expect(page.getByTestId("leg-alert").first()).toContainText("em risco: no banco");
  const alts = page.locator("li", { has: page.getByTestId("alternatives") }).first().getByTestId("alternatives");
  await expect(alts.getByTestId("alt-avoids").first()).toContainText("alternativa sem ele");

  await page.goto("/app/bankroll?lang=pt");
  await expect(page.getByTestId("entry-alert").first()).toContainText("escalação: 1 linha em risco");

  const mine = await page.request.get("/api/alerts").then((r) => r.json());
  const lineup = mine.notifications.filter((n: { kind: string }) => n.kind === "lineup");
  expect(lineup).toHaveLength(1);
  expect(lineup[0].body).toContain("Téo Lins começa no banco");
  const theirs = await paused.request.get("/api/alerts").then((r) => r.json());
  expect(theirs.notifications.filter((n: { kind: string }) => n.kind === "lineup")).toHaveLength(0);

  const second = await runLineups();
  expect(second).toMatchObject({ alerts: 0, notified: 0 });
  const after = await page.request.get("/api/alerts").then((r) => r.json());
  expect(after.notifications.filter((n: { kind: string }) => n.kind === "lineup")).toHaveLength(1);
  await ctx.close();
});
