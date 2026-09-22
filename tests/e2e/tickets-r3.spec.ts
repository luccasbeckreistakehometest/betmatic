import { test, expect } from "@playwright/test";
import { registerUser, setPlan, skipTour, withAiMock } from "./helpers";

withAiMock();

const generated = async (page: import("@playwright/test").Page) =>
  Number((await page.getByTestId("proof-stats").locator(".nums").first().textContent())?.trim() ?? "0");

test("a paid user gets priced player legs, line movement and two alternatives under a ticket", async ({ page }) => {
  const { email } = await registerUser(page, "pro");
  await setPlan(email, "pro");
  await skipTour(page);

  await page.goto("/prova?lang=pt");
  const before = await generated(page);
  await page.goto("/prova?lang=pt&alts=1");
  const beforeWithAlts = await generated(page);

  await page.goto("/app/game/990000101?sport=wnba&lang=pt");
  await expect(page.getByTestId("ticket-bankroll").first()).toBeVisible({ timeout: 60_000 });
  // Player legs carry the posted price and the measured record at that exact line.
  await expect(page.getByTestId("leg-measured").first()).toContainText("L5");
  await expect(page.getByTestId("leg-movement").first()).toContainText("abriu");
  await expect(page.getByTestId("leg-player-link").first()).toHaveAttribute("href", /\/app\/player\/\d+\?sport=wnba/);

  // "Onde apostar": the best book opens with the leg already in its betslip — a real external link
  // in a new tab, the book's own URL, never one of ours — and the whole double at the one book that
  // prices both legs. The seeded books (tests/e2e/seed-books.mts) give Superbet every leg.
  const legLink = page.getByTestId("leg-open-book").first();
  await expect(legLink).toBeVisible({ timeout: 30_000 });
  await expect(legLink).toHaveAttribute("href", /^https:\/\/superbet\.bet\.br\/betslip\?bets%5B%5D=99000101%2C\d+%2C.*&type=simple&target_screen=soccer_event_details$/);
  await expect(legLink).toHaveAttribute("target", "_blank");
  await expect(legLink).toHaveAttribute("rel", /noopener/);
  await expect(legLink).toHaveAttribute("data-kind", "betslip");
  await expect(legLink).toContainText("Abrir na Superbet");
  await expect(page.getByTestId("leg-links").first()).toContainText("bilhete pronto");
  const ticketLink = page.getByTestId("ticket-open-book").first();
  await expect(ticketLink).toContainText("Abrir bilhete inteiro na Superbet");
  await expect(ticketLink).toHaveAttribute("href", /superbet\.bet\.br\/betslip\?bets%5B%5D=/);
  // The player double is priced whole by Superbet alone: its link carries both legs into one slip.
  const double = page.getByTestId("ticket-link").filter({ hasText: "2 pernas" }).first();
  await expect(double).toBeVisible();
  const doubleHref = await double.getByTestId("ticket-open-book").getAttribute("href");
  expect(new URL(doubleHref!).searchParams.getAll("bets[]")).toHaveLength(2);
  // The outbound click is counted (the beacon is a 204, the page stays put: the link opens a new tab).
  // The book's site is stubbed in this context: a test never loads a bookmaker for real.
  await page.context().route(/^https:\/\/superbet\.bet\.br\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>" }));
  const clicked = page.waitForResponse((r) => r.url().endsWith("/api/e") && r.status() === 204);
  const [popup] = await Promise.all([page.waitForEvent("popup"), legLink.click()]);
  await clicked;
  await popup.close();
  await expect(page).toHaveURL(/\/app\/game\/990000101/);

  const alts = page.getByTestId("alternatives");
  await expect(alts).toHaveCount(1);
  await expect(alts.locator("summary")).toContainText("2 alternativas");
  await alts.locator("summary").click();
  await expect(alts.getByTestId("alternative")).toHaveCount(2);
  await expect(alts.getByTestId("alt-diff").first().locator("li.line-through")).toHaveCount(1);
  await expect(alts.getByText("Quando trocar").first()).toBeVisible();
  // The minutes gate removed the 12-minute bench player before the prompt.
  // (The roster panel still lists her as a deep-dive link; the legs live in the tickets' <ol>.)
  await expect(page.locator("ol li", { hasText: "Cris Rocha" })).toHaveCount(0);

  // The public record counts main tickets only: three here, not five.
  await page.goto("/prova?lang=pt");
  expect(await generated(page)).toBe(before + 3);
  await page.getByTestId("alts-toggle").click();
  await expect(page).toHaveURL(/alts=1/);
  expect(await generated(page)).toBe(beforeWithAlts + 5);
});
