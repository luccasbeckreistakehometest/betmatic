import { request as pwRequest, test, expect, type Page } from "@playwright/test";
import { closeTicket, openTicket, openTicketWith, registerUser, setPlan, skipTour, withAiMock } from "./helpers";

withAiMock();

const GAME = "/app/game/990000201?sport=soccer-bra&lang=pt";

async function runLineups() {
  const api = await pwRequest.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3300" });
  expect((await api.post("/api/auth/login", { data: { email: "admin@betmatic.app", password: "betmatic2026" } })).ok()).toBeTruthy();
  const r = await api.post("/api/cron/refresh?job=lineups");
  expect(r.ok(), await r.text()).toBeTruthy();
  const body = await r.json();
  await api.dispose();
  return body as { games: number; alerts: number; notified: number };
}

/**
 * The ticket the watcher will flag is the one with alternatives behind it, and "behind it" now
 * means inside its sheet — so the card is found by opening it, and the stake is put on the card
 * itself. This account has no bankroll on file, which is exactly why the amount is given in reais:
 * a unit with no bankroll behind it is a number the product refuses to invent.
 */
async function saveMainTicket(page: Page) {
  await page.goto(GAME);
  await expect(page.getByTestId("ticket").first()).toBeVisible({ timeout: 60_000 });
  const { index } = await openTicketWith(page, '[data-testid="alternatives"]');
  await closeTicket(page);
  const main = page.getByTestId("ticket").nth(index);
  await main.getByTestId("ticket-add-open").click();
  await expect(main.getByTestId("ticket-bankroll-ask")).toBeVisible();
  await main.getByTestId("ticket-stake-money").click();
  await main.getByTestId("ticket-stake").fill("10");
  await expect(main.getByTestId("ticket-return")).toContainText("R$");
  await main.getByTestId("ticket-add").click();
  await expect(main.getByText("✓")).toBeVisible();
  return index;
}

test("lineup watcher: a benched player flags the leg, the backup without him, the bankroll entry, and alerts savers once", async ({ page, browser }) => {
  const { email } = await registerUser(page, "lineup");
  await setPlan(email, "pro");
  await skipTour(page);
  const main = await saveMainTicket(page);

  // A second saver who then pauses: nothing reaches them.
  const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3300", locale: "pt-BR" });
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
  // The banner is the warning at a glance; the flagged line itself is in the ticket's sheet, beside
  // the backup that avoids him.
  const flagged = await openTicket(page, main);
  await expect(flagged.getByTestId("leg-alert").first()).toContainText("em risco: no banco");
  await expect(flagged.getByTestId("alternatives").getByTestId("alt-avoids").first()).toContainText("alternativa sem ele");
  await closeTicket(page);

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
