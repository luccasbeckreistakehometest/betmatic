import { test, expect } from "@playwright/test";
import { openTicketWith, registerUser, setPlan, skipTour, withAiMock } from "./helpers";

withAiMock();

const ANA = "/app/player/7101?sport=wnba&game=990000101&lang=pt";
const coins = async (page: import("@playwright/test").Page) => (await page.request.get("/api/auth/me").then((r) => r.json())).user.coins as number;

test("player deep dive: line drag, with/without split, a read paid once and shared, the free daily cap", async ({ page, browser }) => {
  const { email } = await registerUser(page, "dive");
  await setPlan(email, "pro", 20);
  await skipTour(page);

  // From a ticket leg to the deep dive (a game no other spec counts tickets on). The legs with
  // their names live in the ticket's sheet, which the card opens.
  await page.goto("/app/game/990000104?sport=wnba&lang=pt");
  await expect(page.getByTestId("ticket").first()).toBeVisible({ timeout: 60_000 });
  const { sheet } = await openTicketWith(page, '[data-testid="leg-player-link"]');
  await sheet.getByTestId("leg-player-link").first().click();
  await expect(page).toHaveURL(/\/app\/player\/\d+\?/);
  await expect(page.getByTestId("player-name")).toBeVisible();

  await page.goto(ANA);
  await expect(page.getByTestId("player-name")).toHaveText("Ana Lima");
  await expect(page.getByTestId("line-value")).toHaveText("17,5");
  await expect(page.getByTestId("posted-lines")).toContainText("chance sem a margem 51%");
  const rates = page.getByTestId("player-rates");
  await expect(rates).toContainText(/60\s*%/);
  for (let i = 0; i < 4; i++) await page.getByTestId("line-up").click();
  await expect(page.getByTestId("line-value")).toHaveText("19,5");
  await expect(rates).toContainText(/40\s*%/);
  await expect(page.getByTestId("player-role")).toContainText("titular");

  // The bench guard missed five games: enough on both sides. Bia never missed one: not enough.
  await page.getByTestId("split-mate").selectOption({ label: "Cris Rocha" });
  await expect(page.getByTestId("split-result")).toContainText("15 jogos");
  await expect(page.getByTestId("split-result")).toContainText("5 jogos");
  await page.getByTestId("split-mate").selectOption({ label: "Bia Souza" });
  await expect(page.getByTestId("split-small")).toContainText("Amostra insuficiente");

  // The analyst read: 5 coins once.
  await expect(page.getByTestId("player-read-btn")).toContainText("5 coins");
  await page.getByTestId("player-read-btn").click();
  await expect(page.getByTestId("player-read")).toContainText("Ana Lima");
  await expect(page.getByTestId("player-read-note")).toContainText("gastou 5 coins");
  expect(await coins(page)).toBe(15);

  // A free user: the same player (their one of the day) shows the stored read at no cost; a second player is capped.
  const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3300", locale: "pt-BR" });
  const other = await ctx.newPage();
  await registerUser(other, "divefree");
  await skipTour(other);
  await other.goto(ANA);
  await expect(other.getByTestId("player-read")).toContainText("Ana Lima");
  await expect(other.getByTestId("player-read-btn")).toHaveCount(0);
  expect(await coins(other)).toBe(0);
  await other.goto("/app/player/7201?sport=wnba&game=990000101&lang=pt");
  await expect(other.getByTestId("player-cap")).toContainText("1 jogador por dia");
  await expect(other.getByRole("link", { name: "Ver planos" })).toBeVisible();
  await ctx.close();
});
