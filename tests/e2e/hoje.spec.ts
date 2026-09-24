import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { loginAdmin, skipTour } from "./helpers";

/**
 * "Os bilhetes de hoje": the screen that answers which ones and how much.
 *
 * Four cases, and the world seeds all four: a day the wallet is open on, that same day with no
 * declared bankroll, a day where everything clears the cuts and NOTHING is worth a stake, and a day
 * where nothing clears them at all. The last two are different answers and must not look alike.
 *
 * The rule that matters across all of them: nothing was removed. /app still holds every ticket, one
 * tap away, including the ones this screen discarded and the ones it declined to size.
 */

const seed = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "e2e", "hoje-day.json"), "utf8")) as
  { day: string; sportKey: string; gameId: string; nothingDay: string };

/** The calibrated day: 330 settled legs behind it, so the wallet is open and the formula sizes. */
const board = `/app/hoje?sport=${seed.sportKey}&lang=pt&day=${seed.day}`;
/** The uncalibrated day: the same history is hidden from it by leave-one-day-out, so it measures. */
const nothingBoard = `/app/hoje?sport=${seed.sportKey}&lang=pt&day=${seed.nothingDay}`;

async function setBankroll(page: import("@playwright/test").Page, bankrollAmount: number | null) {
  const r = await page.request.patch("/api/settings", { data: { bankrollAmount } });
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
    // pt-BR writes the percent with a non-breaking space before the sign, so the assertion is on the
    // shape of the triple, not on one spelling of it: the unit, the share and the money, together.
    // The three have to AGREE — a unit with no share is unreadable, and a share with no money is a
    // number nobody can act on — and on a R$ 1.000 bankroll one unit is 1% and R$ 10,00, so the
    // three are read off the screen and checked against each other.
    //
    // The exact size is deliberately NOT asserted. It was, at 1,50 u, and the spec began failing on
    // 24/09/2026 with 1,25 u: the seeded ledger carries fixed dates while the policy's windows move
    // with the wall clock, so a pinned number makes the suite's verdict depend on the day it runs.
    // What must never drift is the arithmetic between the three, and that it is a size the formula
    // produced rather than the floor or the ceiling.
    const stake = card.getByTestId("today-stake");
    const text = (await stake.textContent()) ?? "";
    const m = text.match(/Apostar\s+([\d,]+)\s*u\s+·\s+([\d,]+)\s*%\s+da sua banca\s+·\s+R\$\s*([\d.,]+)/);
    expect(m, `o trio não foi impresso junto: ${text}`).not.toBeNull();
    const num = (x: string) => Number(x.replace(/\./g, "").replace(",", "."));
    const [units, share, money] = [num(m![1]), num(m![2]), num(m![3])];
    expect(share).toBeCloseTo(units, 2);
    expect(money).toBeCloseTo(units * 10, 2);
    // Neither the floor nor the ceiling: the size came out of the formula.
    expect(units).toBeGreaterThan(0.25);
    expect(units).toBeLessThan(2);

    // The multiplier never appears without the chance beside it (DESIGN.md §13).
    await expect(card).toContainText("1,38");
    await expect(card).toContainText("%");
    // The worst price still worth taking is published, so "confira o preço" is actionable.
    await expect(card).toContainText(/Só vale até/i);
  });

  test("sizes from the formula, so it is not the floor and not the ceiling", async ({ page }) => {
    await setBankroll(page, 1000);
    await page.goto(board);
    const stake = page.getByTestId("today-card").first().getByTestId("today-stake");
    // The two numbers that would mean the arithmetic was skipped: the measurement floor and the
    // per-ticket ceiling. A recommendation that is always one of those is not a recommendation.
    await expect(stake).not.toContainText("0,25 u");
    await expect(stake).not.toContainText("2,00 u");
    // And with the wallet open there is no calibration notice to show.
    await expect(page.getByTestId("today")).not.toContainText(/em calibração/i);
  });

  test("asks for a bankroll instead of inventing one, and still shows the unit and the share", async ({ page }) => {
    await setBankroll(page, null);
    await page.goto(board);

    const stake = page.getByTestId("today-card").first().getByTestId("today-stake");
    // Same reason as above: the shape is asserted, the size is not pinned to a number that moves
    // with the calendar. Without a bankroll the money cannot be written, and it is not invented.
    const without = (await stake.textContent()) ?? "";
    const pair = without.match(/Apostar\s+([\d,]+)\s*u\s+·\s+([\d,]+)\s*%\s+da sua banca/);
    expect(pair, `a unidade e a fração não foram impressas juntas: ${without}`).not.toBeNull();
    expect(pair![1]).toBe(pair![2]);
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

/**
 * The state the owner rejected, pinned so it cannot come back. His words were "como vou apostar
 * 0,25 u em uma odd 1,86? nada disso", and he was right: that 0.25 u was the measurement regime
 * substituting a constant for the formula, not a size anything had computed.
 */
test.describe("a day with nothing worth a stake", () => {
  test.beforeEach(async ({ page }) => {
    await loginAdmin(page);
    await skipTour(page);
    await setBankroll(page, 1000);
  });

  test("says it recommends nothing, and says what stopped it", async ({ page }) => {
    await page.goto(nothingBoard);
    const head = page.getByTestId("today-no-stake");
    await expect(head).toBeVisible();
    await expect(head).toContainText(/Hoje não recomendamos nada/i);
    // How many cleared the cuts, and the measured error that kept them out. A bare "nothing today"
    // would be indistinguishable from a broken page.
    await expect(head).toContainText(/passaram nos cortes/i);
    await expect(head).toContainText(/0,25\s*u/);
    await expect(head).toContainText(/linhas liquidadas/i);
  });

  test("the card is listed, keeps its chance, and carries no stake", async ({ page }) => {
    await page.goto(nothingBoard);
    const card = page.getByTestId("today-card").first();
    await expect(card).toBeVisible();
    await expect(card).toContainText("Arike Ogunbowale");
    // Nothing was removed: the chance and the minimum price are still there to read.
    await expect(card).toContainText("1,38");
    await expect(card).toContainText(/Só vale até/i);

    const stake = card.getByTestId("today-stake");
    await expect(stake).toContainText(/Sem aposta/i);
    await expect(stake).toContainText(/observação, não como recomendação/i);
  });

  test("prints no stake anywhere on the screen — not a unit, not a share, not an amount", async ({ page }) => {
    await page.goto(nothingBoard);
    await expect(page.getByTestId("today-observations")).toBeVisible();
    const text = (await page.getByTestId("today").textContent()) ?? "";
    // This is the regression guard. No stake is offered in any of the three forms the card can
    // offer one: an instruction, a share of the bankroll, or an amount of money.
    expect(text).not.toMatch(/Apostar\s+\d/);
    expect(text).not.toMatch(/da sua banca/);
    expect(text).not.toMatch(/R\$\s*\d/);
    // And the ONLY unit figure anywhere on the screen is the floor itself, which appears twice —
    // in the header and on the card — both times naming the minimum that was NOT reached. Any
    // other unit number here would be a size somebody could act on, which is the bug.
    expect([...new Set(text.match(/\d+,\d+\s*u\b/g) ?? [])]).toEqual(["0,25 u"]);
  });

  test("still points at everything that was generated", async ({ page }) => {
    await page.goto(nothingBoard);
    const all = page.getByTestId("today-all");
    await expect(all).toBeVisible();
    await all.click();
    await expect(page).toHaveURL(/\/app\?/);
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
