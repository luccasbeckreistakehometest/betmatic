import { test, expect } from "@playwright/test";
import { registerUser, skipTour } from "./helpers";

/**
 * The menu is the product's index: if a door is not in front of the reader, it is in here, with one
 * line saying what it is for and, where it costs something, that price on the row — before the tap.
 * These specs hold that shape on a desk; the phone's sheet is in mobile.spec.ts.
 */
const Q = "sport=soccer-esp&lang=pt";

test.describe.configure({ timeout: 180_000 });

test("the menu holds every door, including the ones the rail does not carry", async ({ page }) => {
  await registerUser(page, "menu");
  await skipTour(page);
  await page.goto(`/app?${Q}&date=20260911`);
  await page.getByTestId("menu-button").click();
  const menu = page.getByTestId("app-menu");
  await expect(menu).toBeVisible();

  // The four rooms, each saying what the reader comes there to do.
  for (const [room, intent] of [["Mesa", "Escolher o que apostar hoje"], ["Banca", "Ver quanto você ganhou ou perdeu"], ["Mercado", "Conferir os números antes de confiar"], ["Conta", "Seu plano, seus limites, seus dados"]] as const) {
    await expect(menu).toContainText(room);
    await expect(menu).toContainText(intent);
  }

  // The doors the rail carries.
  for (const name of ["Hoje", "Jogos", "Múltiplas", "Meu bilhete", "Minha banca", "Histórico", "Relatório da semana", "Alertas", "Raio-x do tipster", "Ranking", "Ajustes", "Minha conta", "Indique", "Planos"]) {
    await expect(menu.getByRole("link", { name }).first()).toBeVisible();
  }
  // The doors it does not: these had no way in from inside the app before the menu.
  for (const name of ["Múltipla sob medida", "Prova pública", "Calculadoras", "Fale com a gente", "Jogo responsável"]) {
    await expect(menu.getByRole("link", { name }).first()).toBeVisible();
  }
  // Admin is not a door for a member.
  await expect(menu.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
});

test("a price is on the row, before the tap", async ({ page }) => {
  await registerUser(page, "preco");
  await skipTour(page);
  await page.goto(`/app?${Q}&date=20260911`);
  await page.getByTestId("menu-button").click();
  const menu = page.getByTestId("app-menu");
  await expect(menu.locator('[data-menu-row="/app/parlays"]')).toContainText("Pro");
  await expect(menu.locator('[data-menu-row="/app/slip"]')).toContainText("8 coins");
  await expect(menu.getByTestId("menu-custom-parlay")).toContainText("12 coins");
  await expect(menu.locator('[data-menu-row="/app"]')).toContainText("1 jogo por dia no grátis");
  await expect(menu.locator('[data-menu-row="/app/tipster"]')).toContainText("1 por mês no grátis");
});

test("a feature with no page is named with the place it lives", async ({ page }) => {
  await registerUser(page, "dentro");
  await skipTour(page);
  await page.goto(`/app?${Q}&date=20260911`);
  await page.getByTestId("menu-button").click();
  const menu = page.getByTestId("app-menu");
  // Named, explained, located — and never a link, because there is nowhere to send the reader.
  const player = menu.locator('[data-menu-hint="player"]');
  await expect(player).toContainText("Raio-x do jogador");
  await expect(player).toContainText("toque no nome do jogador");
  await expect(player).toContainText("1 por dia no grátis");
  await expect(player.getByRole("link")).toHaveCount(0);
  await expect(menu.locator('[data-menu-hint="scan"]')).toContainText("dentro de Minha banca");
  await expect(menu.locator('[data-menu-hint="quarter"]')).toContainText("Pro");
});

test("the menu takes the keyboard: Esc closes it and the focus comes back to its button", async ({ page }) => {
  await registerUser(page, "teclado");
  await skipTour(page);
  await page.goto(`/app?${Q}&date=20260911`);
  const button = page.getByTestId("menu-button");
  await button.click();
  await expect(page.getByTestId("app-menu")).toBeVisible();
  // The native <dialog> traps the focus: tabbing never leaves the menu.
  await page.keyboard.press("Tab");
  await expect(page.locator("dialog:modal")).toHaveCount(1);
  expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("app-menu")).toBeHidden();
  await expect(button).toBeFocused();
});

test("a row opens its door, and the menu does not stay behind the page", async ({ page }) => {
  await registerUser(page, "porta");
  await skipTour(page);
  await page.goto(`/app?${Q}&date=20260911`);
  await page.getByTestId("menu-button").click();
  await page.getByTestId("app-menu").getByTestId("menu-proof").click();
  await expect(page).toHaveURL(/\/prova/);
  // One press of back returns to the slate: opening the menu left no entry of its own behind.
  await page.goBack();
  await expect(page).toHaveURL(/\/app\?/);
});
