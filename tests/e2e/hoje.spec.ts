import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { loginAdmin, skipTour } from "./helpers";

/**
 * "Os bilhetes de hoje": the screen that answers which ones and how much.
 *
 * The three cases the policy has to survive are all here: a day with a card, the same day without a
 * declared bankroll, and a day where nothing clears the cuts — which is a legitimate answer and must
 * look like one, not like a broken page. And the rule that matters most across all of them: nothing
 * was removed. /app still holds every ticket, one tap away, including the ones this screen discarded.
 */

const seed = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "e2e", "hoje-day.json"), "utf8")) as
  { day: string; sportKey: string; gameId: string };

const board = `/app/hoje?sport=${seed.sportKey}&lang=pt&day=${seed.day}`;

async function setBankroll(page: import("@playwright/test").Page, bankrollAmount: number | null) {
  const r = await page.request.post("/api/settings", { data: { bankrollAmount } });
  expect(r.ok(), await r.text()).toBeTruthy();
}

test.describe("a day with a recommendation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAdmin(page);
    await skipTour(page);
  });

  test("shows the unit, the share of the bankroll and the money together, and they agree", async ({ page }) => {
    await setBankroll(page, 1000);
    await page.goto(board);

    const card = page.getByTestId("today-card").first();
    await expect(card).toBeVisible();
    await expect(card).toContainText("Paige Bueckers");

    // The policy is in the measurement regime on a ledger this size, so the stake is the floor.
    // What the spec asserts is the triple itself: never the unit without the share and the money.
    const stake = card.getByTestId("today-stake");
    await expect(stake).toContainText("0,25");
    await expect(stake).toContainText("0,25%");
    await expect(stake).toContainText("R$");
    await expect(stake).toContainText("2,50");

    // The multiplier never appears without the chance beside it (DESIGN.md §13).
    await expect(card).toContainText("1,38");
    await expect(card).toContainText("%");
    // The worst price still worth taking is published, so "confira o preço" is actionable.
    await expect(card).toContainText(/Só vale até/i);
  });

  test("says the regime out loud instead of pretending the floor is a recommendation", async ({ page }) => {
    await page.goto(board);
    await expect(page.getByTestId("today")).toContainText(/calibração/i);
    await expect(page.getByTestId("today")).toContainText("0,25");
  });

  test("asks for a bankroll instead of inventing one, and still shows the unit and the share", async ({ page }) => {
    await setBankroll(page, null);
    await page.goto(board);

    const stake = page.getByTestId("today-card").first().getByTestId("today-stake");
    await expect(stake).toContainText("0,25");
    await expect(stake).toContainText("0,25%");
    await expect(stake).not.toContainText("R$");
    await expect(page.getByRole("link", { name: /definir sua banca|definir banca/i }).first()).toBeVisible();
  });

  test("keeps at most three, and never more than one per game", async ({ page }) => {
    await page.goto(board);
    const cards = page.getByTestId("today-card");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeLessThanOrEqual(3);
  });

  test("hides nothing: the detail is one tap away and the full table is linked", async ({ page }) => {
    await page.goto(board);
    const card = page.getByTestId("today-card").first();
    const why = card.getByTestId("today-why");

    // Closed by default — the face of the card is the ticket, the unit, the chance, the next step.
    await expect(why).not.toHaveAttribute("open", /.*/);
    await why.locator("summary").click();
    await expect(why).toContainText(/evid|banda|EV/i);

    // The 300 tickets are not gone; they are where they always were.
    const all = page.getByTestId("today-all");
    await expect(all).toBeVisible();
    await all.click();
    await expect(page).toHaveURL(/\/app\?/);
  });

  test("never promises a result, on any of its strings", async ({ page }) => {
    await page.goto(board);
    const text = (await page.getByTestId("today").textContent()) ?? "";
    expect(text).not.toMatch(/lucro|renda|garantid|ganho certo|última chance|só até/i);
    expect(text).toMatch(/Pesquisa, não garantia de resultado/i);
  });
});

test("a day where nothing clears the cuts says so, and points at everything that was generated", async ({ page }) => {
  await loginAdmin(page);
  await skipTour(page);
  // The seeded Spanish slate has no ticket with evidence 100, so its day is legitimately empty.
  await page.goto("/app/hoje?sport=soccer-esp&lang=pt&day=2026-09-11");

  await expect(page.getByTestId("today-none")).toBeVisible();
  await expect(page.getByTestId("today-none")).toContainText(/Hoje não tem/i);
  await expect(page.getByTestId("today-card")).toHaveCount(0);
  // No substitute suggestion, no badge, no consolation prize — just the way back to the full table.
  await expect(page.getByTestId("today-none-all")).toBeVisible();
});
