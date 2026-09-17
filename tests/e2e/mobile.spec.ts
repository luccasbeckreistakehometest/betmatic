import { test, expect, type Page } from "@playwright/test";
import { registerUser, skipTour } from "./helpers";

async function noSideScroll(page: Page, path: string) {
  const r = await page.goto(path, { waitUntil: "load" });
  expect(r?.status(), path).toBeLessThan(400);
  await page.waitForTimeout(250); // client components (header, panels) have rendered
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `${path} is ${scroll}px wide on a ${inner}px screen`).toBeLessThanOrEqual(inner + 1);
}

// The dev server compiles each page on first visit; a dozen pages need more than the default budget.
test.describe.configure({ timeout: 300_000 });

test("public pages fit a phone and show 'Entrar'", async ({ page }) => {
  for (const path of ["/?lang=pt", "/?lang=en", "/futebol", "/basketball", "/planos", "/prova", "/ferramentas", "/contato", "/termos", "/privacy", "/jogo-responsavel", "/login", "/signup"]) {
    await noSideScroll(page, path);
  }
  await page.goto("/?lang=pt");
  await expect(page.getByTestId("landing-login")).toBeVisible();
  await expect(page.getByTestId("hero-cta")).toHaveText("Criar conta grátis");
});

test("the signed-in app fits a phone, and the menu holds navigation and logout", async ({ page }) => {
  await registerUser(page, "celular");
  await skipTour(page);
  const q = "sport=soccer-esp&lang=pt";
  for (const path of [`/app?${q}&date=20260911`, `/app/game/401882878?${q}`, `/app/parlays?${q}`, `/app/slip?${q}`, `/app/track?${q}`, `/app/bankroll?${q}`, `/app/alerts?${q}`, `/app/ranking?${q}`, `/app/referral?${q}`, `/app/settings?${q}`, `/app/conta?${q}`]) {
    await noSideScroll(page, path);
  }
  await page.goto(`/app?${q}&date=20260911`);
  await page.getByTestId("menu-button").click();
  const menu = page.getByTestId("app-menu");
  await expect(menu.getByRole("link", { name: "Minha banca" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Minha conta" })).toBeVisible();
  await expect(page.getByTestId("logout")).toBeVisible();
  const box = await menu.boundingBox();
  const width = await page.evaluate(() => window.innerWidth);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  await menu.getByRole("link", { name: "Minha banca" }).click();
  await expect(page).toHaveURL(/\/app\/bankroll/);
});

test("the admin panel fits a phone", async ({ page }) => {
  const { loginAdmin } = await import("./helpers");
  await loginAdmin(page);
  await noSideScroll(page, "/admin");
});
