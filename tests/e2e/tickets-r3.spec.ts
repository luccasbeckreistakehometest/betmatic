import { test, expect } from "@playwright/test";
import { registerUser, setPlan, skipTour, withAiMock } from "./helpers";

withAiMock();

const generated = async (page: import("@playwright/test").Page) =>
  Number((await page.getByTestId("proof-stats").locator("div.nums").first().textContent())?.trim() ?? "0");

test("a paid user gets priced player legs, line movement and two alternatives under a ticket", async ({ page }) => {
  const { email } = await registerUser(page, "pro");
  await setPlan(email, "pro");
  await skipTour(page);

  await page.goto("/prova?lang=pt");
  const before = await generated(page);

  await page.goto("/app/game/990000101?sport=wnba&lang=pt");
  await expect(page.getByTestId("ticket-bankroll").first()).toBeVisible({ timeout: 60_000 });
  // Player legs carry the posted price and the measured record at that exact line.
  await expect(page.getByTestId("leg-measured").first()).toContainText("L5");
  await expect(page.getByTestId("leg-movement").first()).toContainText("abriu");
  await expect(page.getByTestId("leg-player-link").first()).toHaveAttribute("href", /\/app\/player\/\d+\?sport=wnba/);

  const alts = page.getByTestId("alternatives");
  await expect(alts).toHaveCount(1);
  await expect(alts.locator("summary")).toContainText("2 alternativas");
  await alts.locator("summary").click();
  await expect(alts.getByTestId("alternative")).toHaveCount(2);
  await expect(alts.getByTestId("alt-diff").first().locator("li.line-through")).toHaveCount(1);
  await expect(alts.getByText("Quando trocar").first()).toBeVisible();
  // The minutes gate removed the 12-minute bench player before the prompt.
  await expect(page.getByText("Cris Rocha")).toHaveCount(0);

  // The public record counts main tickets only: three here, not five.
  await page.goto("/prova?lang=pt");
  expect(await generated(page)).toBe(before + 3);
  await page.getByTestId("alts-toggle").click();
  await expect(page).toHaveURL(/alts=1/);
  expect(await generated(page)).toBe(before + 5);
});
