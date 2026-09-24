import path from "node:path";
import Database from "better-sqlite3";
import { test, expect } from "@playwright/test";
import { closeTicket, openTicketWith, registerUser, setPlan, skipTour, withAiMock } from "./helpers";

withAiMock();

const slateRows = () => {
  const db = new Database(path.join(process.cwd(), "data", "e2e", "betmatic.db"), { readonly: true });
  try { return (db.prepare("SELECT COUNT(*) n FROM generation_requests WHERE scope='slate'").get() as { n: number }).n; } finally { db.close(); }
};

/**
 * "As múltiplas do dia entre jogos". The scheduler builds them every day (server/cross-daily.ts);
 * here nothing runs the cron, so the section is filled by the button that is still under it — which
 * is the same build, in the same window, through the same code (server/slate-build.ts).
 */
test("the day's cross-game parlays are doubles inside the window, built once a day", async ({ page }) => {
  await registerUser(page, "free");
  expect((await page.request.post("/api/parlays/generate?sport=wnba")).status()).toBe(403);

  const { email } = await registerUser(page, "slate");
  await setPlan(email, "pro");
  await skipTour(page);
  await page.goto("/app/parlays?sport=wnba&lang=pt");
  // The window is printed before the tickets, so nobody has to open one to learn what this section
  // promises — and it is written from the constants the build is gated on.
  await expect(page.getByTestId("cross-window")).toContainText("2,00x a 5,00x");
  await page.getByTestId("build-slate").click();
  await expect(page.getByTestId("ticket").first()).toBeVisible({ timeout: 60_000 });

  // Every ticket the section shows is a combination across matches inside the window: two or three
  // lines, and a price the record can defend. Above 20x the pre-game ledger is 0 green in 34.
  const tickets = page.getByTestId("ticket");
  const count = await tickets.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const ticket = tickets.nth(i);
    await expect(ticket).toHaveAttribute("data-band", "value");
    const lines = await ticket.getByTestId("ticket-line").count();
    expect(lines).toBeGreaterThanOrEqual(2);
    expect(lines).toBeLessThanOrEqual(3);
  }
  // The record that decided the window is on the page, in the reader's own words, not buried.
  await expect(page.getByTestId("cross-honesty")).toContainText("de 20x pra cima nenhum em 34");

  // The real chance and the multiplier are inside the sheet the card opens, the same sheet a
  // single-game ticket has. The card itself carries the combined price with its chance beside it.
  const { sheet } = await openTicketWith(page, '[data-testid="ticket-numbers"]');
  const numbers = sheet.getByTestId("ticket-numbers");
  await expect(numbers.getByText(/[2-4],\d\dx/).first()).toBeVisible();
  await expect(numbers).toContainText("Chance estimada");
  // The "espere perder ~N em 100" warning belongs to a ticket at 50x or more. This section never
  // emits one any more, and a warning nobody needs is not a warning worth printing.
  await expect(sheet.getByTestId("expected-losers")).toHaveCount(0);
  await closeTicket(page);
  expect(slateRows()).toBe(1);

  const again = await page.request.post("/api/parlays/generate?sport=wnba").then((r) => r.json());
  expect(again.status).toBe("exists");
  expect(slateRows()).toBe(1);
});

/**
 * A múltipla is placeable: the same "Onde apostar" block the game page has, built from prices read
 * across the matches the ticket spans. The seed (tests/e2e/seed-books.mts) puts Superbet on both
 * lines of the first double and Betnacional on both too — one book whose URL carries the whole
 * ticket across two matches, and one whose URL can only open one match's page.
 */
test("a cross-game ticket opens in one betslip, with both matches in the URL", async ({ page }) => {
  const { email } = await registerUser(page, "slatebooks");
  await setPlan(email, "pro");
  await skipTour(page);
  await page.goto("/app/parlays?sport=wnba&lang=pt");
  // The slate is built once a day for the whole product, so by the time this spec runs the test
  // above has usually built it already and there is no button to press. Either way, what this spec
  // is about is the tickets being on screen.
  const build = page.getByTestId("build-slate");
  await expect(build.or(page.getByTestId("ticket").first())).toBeVisible({ timeout: 60_000 });
  if (await build.count()) await build.click();
  await expect(page.getByTestId("ticket").first()).toBeVisible({ timeout: 60_000 });

  // The prices arrive after the tickets, the same way the game page loads them. The slate holds more
  // than one cross-game ticket, so the fully covered one is picked by what its link carries, never
  // by its place on the page — the list is sorted by price, not by coverage.
  await expect(page.getByTestId("ticket-create-slip").first()).toBeVisible({ timeout: 30_000 });
  const { index, sheet } = await openTicketWith(page, '[data-testid="ticket-open-book"][data-carried="2"]');
  const prices = sheet.locator('[data-testid="ticket-prices"][data-coverage="full"]');
  await expect(prices).toHaveCount(1);
  const link = prices.getByTestId("ticket-open-book").first();
  await expect(link).toContainText("Abrir o bilhete inteiro na Superbet");
  await expect(link).toHaveAttribute("data-coverage", "full");

  // TWO selections in one URL, and two DIFFERENT matches: that is the whole point of the múltipla
  // link, and the thing a single-game slip could never say.
  const url = new URL((await link.getAttribute("href"))!);
  const bets = url.searchParams.getAll("bets[]");
  expect(bets).toHaveLength(2);
  expect(bets.map((b) => b.split(",")[0])).toEqual(["99000101", "99000103"]);
  await expect(link).toHaveAttribute("data-carried", "2");

  // The price is the product of the two, because a book does not discount a combination across
  // matches — and the ticket says so in its own words rather than leaving the reader to assume it.
  await expect(prices).toContainText("o link paga 3,74x");
  await expect(prices.getByTestId("ticket-cross-game")).toContainText("a casa multiplica as odds em vez de descontar a combinação");

  // The runners-up, ordered by how much of the ticket each can actually carry: a book with a real
  // betslip for one of the two lines, then the book whose URL can only open a match's page — which
  // on a cross-game ticket is half the bet, and which says exactly that instead of implying more.
  await prices.getByTestId("ticket-other-books").locator("summary").click();
  const others = prices.getByTestId("ticket-other-open");
  await expect(others.first()).toContainText("Abrir na KTO com 1 das 2 linhas");
  const pageOnly = others.filter({ hasText: "Betnacional" });
  await expect(pageOnly).toContainText("Abrir a página na Betnacional");
  await expect(pageOnly).toHaveAttribute("data-carried", "0");

  // The outbound click is counted with what the reader was offered, and the book opens in a new tab.
  // It is taken on the card's own button: the múltipla is placed from the face of the slip, and the
  // face never promises more than the URL carries either.
  await closeTicket(page);
  const face = page.getByTestId("ticket").nth(index).getByTestId("ticket-create-slip");
  await expect(face).toContainText("Abrir o bilhete inteiro na Superbet");
  await expect(face).toHaveAttribute("data-carried", "2");
  await page.context().route(/^https:\/\/superbet\.bet\.br\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>" }));
  const clicked = page.waitForResponse((r) => r.url().endsWith("/api/e") && r.status() === 204);
  const [popup] = await Promise.all([page.waitForEvent("popup"), face.click()]);
  await clicked;
  await popup.close();
  await expect(page).toHaveURL(/\/app\/parlays/);
});

test("the slate's prices are behind the same gate as the slate itself", async ({ page }) => {
  // Signed out: no tickets, so no prices.
  expect(await page.request.get("/api/parlays/prices?sport=wnba&lang=pt").then((r) => r.json())).toMatchObject({ tickets: [], books: [] });
  // Signed in on a plan without cross-game tickets: the same empty answer the slate itself gives.
  await registerUser(page, "freebooks");
  expect(await page.request.get("/api/parlays/prices?sport=wnba&lang=pt").then((r) => r.json())).toMatchObject({ tickets: [], books: [] });
  // A sport nobody sells is refused before anything is read.
  expect(await page.request.get("/api/parlays/prices?sport=quadribol&lang=pt").then((r) => r.json())).toMatchObject({ tickets: [] });
});
