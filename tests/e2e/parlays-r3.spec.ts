import path from "node:path";
import Database from "better-sqlite3";
import { test, expect } from "@playwright/test";
import { registerUser, setPlan, skipTour, withAiMock } from "./helpers";

withAiMock();

const slateRows = () => {
  const db = new Database(path.join(process.cwd(), "data", "e2e", "betmatic.db"), { readonly: true });
  try { return (db.prepare("SELECT COUNT(*) n FROM generation_requests WHERE scope='slate'").get() as { n: number }).n; } finally { db.close(); }
};

test("cross-game parlays are built on request for Pro, once a day, with the real chance beside 100x", async ({ page }) => {
  await registerUser(page, "free");
  expect((await page.request.post("/api/parlays/generate?sport=wnba")).status()).toBe(403);

  const { email } = await registerUser(page, "slate");
  await setPlan(email, "pro");
  await skipTour(page);
  await page.goto("/app/parlays?sport=wnba&lang=pt");
  await page.getByTestId("build-slate").click();
  await expect(page.getByTestId("expected-losers").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("expected-losers").first()).toContainText("em 100 bilhetes assim, espere perder ~");
  await expect(page.getByText(/1\d\dx|[2-4]\d\dx/).first()).toBeVisible();
  expect(slateRows()).toBe(1);

  const again = await page.request.post("/api/parlays/generate?sport=wnba").then((r) => r.json());
  expect(again.status).toBe("exists");
  expect(slateRows()).toBe(1);
});

/**
 * A múltipla is placeable: the same "Onde apostar" block the game page has, built from prices read
 * across the matches the ticket spans. The seed (tests/e2e/seed-books.mts) puts Superbet on all
 * three of the slate's lines and Betnacional on all three too — one book whose URL carries the whole
 * ticket across three matches, and one whose URL can only open one match's page.
 */
test("a cross-game ticket opens in one betslip, with the three matches in the URL", async ({ page }) => {
  const { email } = await registerUser(page, "slatebooks");
  await setPlan(email, "pro");
  await skipTour(page);
  await page.goto("/app/parlays?sport=wnba&lang=pt");
  await page.getByTestId("build-slate").click();
  await expect(page.getByTestId("expected-losers").first()).toBeVisible({ timeout: 60_000 });

  // The prices arrive after the tickets, the same way the game page loads them.
  const prices = page.locator('[data-testid="ticket-prices"][data-coverage="full"]').first();
  await expect(prices).toBeVisible({ timeout: 30_000 });
  const link = prices.getByTestId("ticket-open-book").first();
  await expect(link).toContainText("Abrir o bilhete inteiro na Superbet");
  await expect(link).toHaveAttribute("data-coverage", "full");

  // THREE selections in one URL, and three DIFFERENT matches: that is the whole point of the
  // múltipla link, and the thing a single-game slip could never say.
  const url = new URL((await link.getAttribute("href"))!);
  const bets = url.searchParams.getAll("bets[]");
  expect(bets).toHaveLength(3);
  expect(bets.map((b) => b.split(",")[0])).toEqual(["99000101", "99000103", "99000104"]);
  await expect(link).toHaveAttribute("data-carried", "3");

  // The price is the product of the three, because a book does not discount a combination across
  // matches — and the ticket says so in its own words rather than leaving the reader to assume it.
  await expect(prices).toContainText("o link paga 110,54x");
  await expect(prices.getByTestId("ticket-cross-game")).toContainText("a casa multiplica as odds em vez de descontar a combinação");

  // The book that prices every leg and can still only open one match's page says exactly that.
  await prices.getByTestId("ticket-other-books").locator("summary").click();
  const other = prices.getByTestId("ticket-other-open").first();
  await expect(other).toContainText("Abrir a página na Betnacional");
  await expect(other).toHaveAttribute("data-carried", "0");

  // The outbound click is counted with what the reader was offered, and the book opens in a new tab.
  await page.context().route(/^https:\/\/superbet\.bet\.br\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>" }));
  const clicked = page.waitForResponse((r) => r.url().endsWith("/api/e") && r.status() === 204);
  const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
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
