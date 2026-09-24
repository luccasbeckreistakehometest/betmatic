import { test, expect } from "@playwright/test";
import { closeTicket, openTicketWith, registerUser, setPlan, skipTour, withAiMock } from "./helpers";

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

  // The card is a betting slip: the ticket's name, its combined price, and one line per selection
  // with that line's price. Everything else is a tap away, and the whole card is that tap.
  const card = page.getByTestId("ticket").first();
  await expect(card.getByTestId("ticket-line").first()).toBeVisible();
  await expect(card.getByTestId("ticket-line").first().locator(".nums")).toHaveText(/^\d+,\d{2}$/);
  // None of the numbers behind the ticket are on its face: the sheet is a portal at the end of
  // <body>, so nothing it holds is inside the card.
  await expect(card.getByTestId("ticket-numbers")).toHaveCount(0);
  await expect(card.getByTestId("ticket-prices")).toHaveCount(0);
  await expect(card.getByTestId("alternatives")).toHaveCount(0);
  await expect(card).not.toContainText("Contexto");
  await expect(card).not.toContainText("Evidência");

  // Player legs carry the posted price and the measured record at that exact line, inside the sheet.
  const { sheet: playerSheet } = await openTicketWith(page, '[data-testid="leg-measured"]');
  await expect(playerSheet.getByTestId("leg-measured").first()).toContainText("L5");
  await expect(playerSheet.getByTestId("leg-player-link").first()).toHaveAttribute("href", /\/app\/player\/\d+\?sport=wnba/);
  // A dialog's heading must not come before the page's own title in the document: the sheet is a
  // portal at the end of <body>, which is the order a screen reader walks.
  expect(await page.evaluate(() => {
    const dialog = document.querySelector("dialog[open]")!;
    const title = document.querySelector("h1")!;
    return (title.compareDocumentPosition(dialog) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  })).toBe(true);
  // Esc closes the sheet and focus goes back to the card that opened it — the native <dialog>'s own
  // behaviour, which is the whole reason it is the native one.
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("ticket-face");

  // A line whose price moved since the book opened it says so, wherever that line is.
  const { sheet: movedSheet } = await openTicketWith(page, '[data-testid="leg-movement"]');
  await expect(movedSheet.getByTestId("leg-movement").first()).toContainText("abriu");
  await closeTicket(page);

  // "Onde apostar": the best book opens with the leg already in its betslip — a real external link
  // in a new tab, the book's own URL, never one of ours. The seeded books (tests/e2e/seed-books.mts)
  // put the game's three main tickets on the three answers the reader can get.
  // The prices arrive after the tickets; the face's own link is the signal that they landed.
  await expect(page.getByTestId("ticket-create-slip").first()).toBeVisible({ timeout: 30_000 });
  const { sheet: legSheet } = await openTicketWith(page, '[data-testid="leg-open-book"]');
  const legLink = legSheet.getByTestId("leg-open-book").first();
  await expect(legLink).toBeVisible({ timeout: 30_000 });
  await expect(legLink).toHaveAttribute("href", /^https:\/\/superbet\.bet\.br\/betslip\?bets%5B%5D=99000101%2C\d+%2C.*&type=simple&target_screen=soccer_event_details$/);
  await expect(legLink).toHaveAttribute("target", "_blank");
  await expect(legLink).toHaveAttribute("rel", /noopener/);
  await expect(legLink).toHaveAttribute("data-kind", "betslip");
  await expect(legLink).toContainText("Abrir na Superbet");
  await expect(legSheet.getByTestId("leg-links").first()).toContainText("bilhete pronto");
  await closeTicket(page);

  // 1. THE WHOLE TICKET. Superbet posts the single's only line: one link, the whole ticket, and the
  //    price the link itself pays. The card's own button says the same thing, because it is the
  //    same link — and it never promises more than the URL carries.
  const { index: fullIndex, sheet: fullSheet } = await openTicketWith(page, '[data-testid="ticket-prices"][data-coverage="full"]');
  const full = fullSheet.locator('[data-testid="ticket-prices"][data-coverage="full"]');
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
  await closeTicket(page);

  // The same link on the face of that card, with the same promise and the same price.
  const faceLink = page.getByTestId("ticket").nth(fullIndex).getByTestId("ticket-create-slip");
  await expect(faceLink).toContainText("Abrir o bilhete inteiro na Superbet");
  await expect(faceLink).toHaveAttribute("data-carried", "1");
  await expect(page.getByTestId("ticket").nth(fullIndex).getByTestId("ticket-bankroll")).toContainText("o link paga 1,95x");

  // 2. PART OF THE TICKET. Superbet has one of the double's two legs: the link says how much it
  //    carries, names the leg it does not and why, and pays only for what it carries.
  const { index: partialIndex, sheet: partialSheet } = await openTicketWith(page, '[data-testid="ticket-prices"][data-coverage="partial"]');
  const partial = partialSheet.locator('[data-testid="ticket-prices"][data-coverage="partial"]');
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
  //    above it, never multiplied into its price, and never on the face of the card: the button a
  //    reader taps to place THIS ticket has no business offering another one.
  const near = partial.getByTestId("ticket-near-line");
  await expect(near).toContainText("linha parecida: Bia Souza");
  await expect(near).toContainText("mais de 7,5 em vez de 6,5");
  await expect(near).toContainText("paga 2,10 em vez de 1,80");
  await expect(near).toContainText("é outra aposta, não a do bilhete");
  await expect(near.getByTestId("ticket-near-open")).toHaveAttribute("data-coverage", "near");
  await expect(near.getByTestId("ticket-near-open")).toHaveAttribute("data-covered", "0");
  await expect(page.getByTestId("ticket").nth(partialIndex).getByTestId("ticket-bankroll")).not.toContainText("linha parecida");
  // The face's button says what the URL carries, not what the book prices.
  await expect(page.getByTestId("ticket").nth(partialIndex).getByTestId("ticket-create-slip")).toContainText("Abrir na Superbet com 1 das 2 linhas");

  // 4. NOTHING MATCHES. No book row was seeded for the moneyline: the product says so rather than
  //    sending the reader to a page that does not hold their bet — and the card offers the door to
  //    that sentence instead of a link it cannot honour.
  await closeTicket(page);
  const { index: noneIndex, sheet: noneSheet } = await openTicketWith(page, '[data-testid="ticket-prices"][data-coverage="none"]');
  const none = noneSheet.locator('[data-testid="ticket-prices"][data-coverage="none"]');
  await expect(none.getByTestId("ticket-no-slip")).toContainText("nenhuma casa lida tem essas linhas");
  await expect(none.getByTestId("ticket-open-book")).toHaveCount(0);
  await expect(none.getByTestId("ticket-near-line")).toHaveCount(0);
  await closeTicket(page);
  const noneCard = page.getByTestId("ticket").nth(noneIndex);
  await expect(noneCard.getByTestId("ticket-create-slip")).toHaveCount(0);
  await expect(noneCard.getByTestId("ticket-no-link")).toContainText("Onde apostar");

  // The outbound click is counted, with what the reader was actually offered (the beacon is a 204,
  // the page stays put: the link opens a new tab). The book's site is stubbed in this context: a
  // test never loads a bookmaker for real.
  await page.context().route(/^https:\/\/superbet\.bet\.br\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>" }));
  const clicked = page.waitForResponse((r) => r.url().endsWith("/api/e") && r.status() === 204);
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByTestId("ticket").nth(partialIndex).getByTestId("ticket-create-slip").click(),
  ]);
  await clicked;
  await popup.close();
  await expect(page).toHaveURL(/\/app\/game\/990000101/);

  const { sheet: altSheet } = await openTicketWith(page, '[data-testid="alternatives"]');
  const alts = altSheet.getByTestId("alternatives");
  await expect(alts).toHaveCount(1);
  await expect(alts.locator("summary")).toContainText("2 alternativas");
  await alts.locator("summary").click();
  await expect(alts.getByTestId("alternative")).toHaveCount(2);
  await expect(alts.getByTestId("alt-diff").first().locator("li.line-through")).toHaveCount(1);
  await expect(alts.getByText("Quando trocar").first()).toBeVisible();
  await closeTicket(page);
  // The minutes gate removed the 12-minute bench player before the prompt. Her name would be on the
  // face of a card — every selection is — as well as in a sheet's own <ol>.
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
