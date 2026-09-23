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
  // in a new tab, the book's own URL, never one of ours. The seeded books (tests/e2e/seed-books.mts)
  // put the game's three main tickets on the three answers the reader can get.
  const legLink = page.getByTestId("leg-open-book").first();
  await expect(legLink).toBeVisible({ timeout: 30_000 });
  await expect(legLink).toHaveAttribute("href", /^https:\/\/superbet\.bet\.br\/betslip\?bets%5B%5D=99000101%2C\d+%2C.*&type=simple&target_screen=soccer_event_details$/);
  await expect(legLink).toHaveAttribute("target", "_blank");
  await expect(legLink).toHaveAttribute("rel", /noopener/);
  await expect(legLink).toHaveAttribute("data-kind", "betslip");
  await expect(legLink).toContainText("Abrir na Superbet");
  await expect(page.getByTestId("leg-links").first()).toContainText("bilhete pronto");

  // 1. THE WHOLE TICKET. Superbet posts the single's only line: one link, the whole ticket, and the
  //    price the link itself pays.
  const full = page.getByTestId("ticket-prices").filter({ has: page.locator('[data-coverage="full"]') }).or(page.locator('[data-testid="ticket-prices"][data-coverage="full"]')).first();
  await expect(full).toBeVisible();
  const ticketLink = full.getByTestId("ticket-open-book").first();
  await expect(ticketLink).toContainText("Abrir o bilhete inteiro na Superbet");
  await expect(ticketLink).toHaveAttribute("href", /superbet\.bet\.br\/betslip\?bets%5B%5D=/);
  await expect(ticketLink).toHaveAttribute("data-coverage", "full");
  await expect(ticketLink).toHaveAttribute("data-covered", "1");
  await expect(full).toContainText("o link paga 1,95x");
  // The price comparison is one tap away, not in the reader's face: the runner-up book is in there.
  await full.getByTestId("ticket-other-books").locator("summary").click();
  await expect(full.getByTestId("ticket-other-open")).toContainText("Abrir o bilhete inteiro na KTO");
  await expect(full.getByTestId("ticket-best-book")).toContainText("Superbet");

  // 2. PART OF THE TICKET. Superbet has one of the double's two legs: the link says how much it
  //    carries, names the leg it does not and why, and pays only for what it carries.
  const partial = page.locator('[data-testid="ticket-prices"][data-coverage="partial"]').first();
  await expect(partial).toBeVisible();
  const partialLink = partial.getByTestId("ticket-open-book");
  await expect(partialLink).toContainText("Abrir na Superbet com 1 das 2 linhas");
  await expect(partialLink).toHaveAttribute("data-coverage", "partial");
  await expect(partialLink).toHaveAttribute("data-covered", "1");
  expect(new URL((await partialLink.getAttribute("href"))!).searchParams.getAll("bets[]")).toHaveLength(1);
  await expect(partial.getByTestId("ticket-missing")).toContainText("falta: Bia Souza");
  await expect(partial.getByTestId("ticket-missing")).toContainText("a casa não publica essa linha");
  // The link's price is the leg it carries (1,95), never the double's 3,51.
  await expect(partial).toContainText("o link paga 1,95x");

  // 3. THE CLOSEST RUNG, as its own row and as a different bet — never counted into the coverage
  //    above it and never multiplied into its price.
  const near = partial.getByTestId("ticket-near-line");
  await expect(near).toContainText("linha parecida: Bia Souza");
  await expect(near).toContainText("mais de 7,5 em vez de 6,5");
  await expect(near).toContainText("paga 2,10 em vez de 1,80");
  await expect(near).toContainText("é outra aposta, não a do bilhete");
  await expect(near.getByTestId("ticket-near-open")).toHaveAttribute("data-coverage", "near");
  await expect(near.getByTestId("ticket-near-open")).toHaveAttribute("data-covered", "0");

  // 4. NOTHING MATCHES. No book row was seeded for the moneyline: the product says so rather than
  //    sending the reader to a page that does not hold their bet.
  const none = page.locator('[data-testid="ticket-prices"][data-coverage="none"]').first();
  await expect(none).toBeVisible();
  await expect(none.getByTestId("ticket-no-slip")).toContainText("nenhuma casa lida tem essas linhas");
  await expect(none.getByTestId("ticket-open-book")).toHaveCount(0);
  await expect(none.getByTestId("ticket-near-line")).toHaveCount(0);

  // The outbound click is counted, with what the reader was actually offered (the beacon is a 204,
  // the page stays put: the link opens a new tab). The book's site is stubbed in this context: a
  // test never loads a bookmaker for real.
  await page.context().route(/^https:\/\/superbet\.bet\.br\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>" }));
  const clicked = page.waitForResponse((r) => r.url().endsWith("/api/e") && r.status() === 204);
  const [popup] = await Promise.all([page.waitForEvent("popup"), partialLink.click()]);
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

  // The public record counts main tickets only: four here, not six. The fourth is the single on a
  // name none of the others use — the mock world has to clear the by-player cap (src/lib/bets/
  // gates.ts) the same way a real slate does, or the double would be dropped for leaning on Eva
  // Nunes twice in a slate of three.
  await page.goto("/prova?lang=pt");
  expect(await generated(page)).toBe(before + 4);
  await page.getByTestId("alts-toggle").click();
  await expect(page).toHaveURL(/alts=1/);
  expect(await generated(page)).toBe(beforeWithAlts + 6);
});
