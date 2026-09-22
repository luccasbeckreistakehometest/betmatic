import { test, expect, type Page } from "@playwright/test";
import { registerUser, setPlan, skipTour } from "./helpers";

async function noSideScroll(page: Page, path: string) {
  const r = await page.goto(path, { waitUntil: "load" });
  expect(r?.status(), path).toBeLessThan(400);
  await page.waitForTimeout(600); // client components (header, panels, polled data) have rendered
  // Measured against the device's width, not window.innerWidth: a phone's layout viewport grows to
  // fit content that is too wide and innerWidth grows with it, which is exactly the defect to catch.
  const width = page.viewportSize()!.width;
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scroll, `${path} is ${scroll}px wide on a ${width}px screen`).toBeLessThanOrEqual(width + 1);
}

// The dev server compiles each page on first visit; a dozen pages need more than the default budget.
test.describe.configure({ timeout: 300_000 });

test("public pages fit a phone and show 'Entrar'", async ({ page }) => {
  for (const path of ["/?lang=pt", "/?lang=en", "/futebol", "/basketball", "/planos", "/prova", "/ferramentas", "/contato", "/termos", "/privacy", "/jogo-responsavel", "/login", "/signup", "/raio-x-tipster", "/tipster-audit", "/basquete"]) {
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
  for (const path of [`/app?${q}&date=20260911`, `/app/game/401882878?${q}`, `/app/parlays?${q}`, `/app/slip?${q}`, `/app/track?${q}`, `/app/bankroll?${q}`, `/app/alerts?${q}`, `/app/ranking?${q}`, `/app/referral?${q}`, `/app/settings?${q}`, `/app/conta?${q}`,
    `/app/tipster?${q}`, `/app/report?${q}`, `/app/parlays/custom?${q}`, "/app/player/7101?sport=wnba&game=990000101&lang=pt", "/app/game/990000102?sport=wnba&lang=pt"]) {
    await noSideScroll(page, path);
  }
  await page.goto(`/app?${q}&date=20260911`);
  await page.getByTestId("menu-button").click();
  const menu = page.getByTestId("app-menu");
  await expect(menu.getByRole("link", { name: "Minha banca" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Minha conta" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Raio-x do tipster" })).toBeVisible();
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

test("the phone installs as an app: manifest, icons, theme colours, edge-to-edge viewport", async ({ page }) => {
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  const m = await manifest.json();
  expect(m.display).toBe("standalone");
  expect(m.start_url).toBe("/app");
  expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  for (const icon of m.icons) expect((await page.request.get(icon.src)).ok(), icon.src).toBeTruthy();
  await page.goto("/login?lang=pt");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest\.webmanifest/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});

test("the tab bar sits at the bottom, marks where you are, and shows the game under way", async ({ page }) => {
  await registerUser(page, "tabs");
  await skipTour(page);
  await page.goto("/app?sport=wnba&lang=pt");
  const bar = page.getByTestId("tab-bar");
  await expect(bar).toBeVisible();
  // The WNBA slate has a game in play, so the live tab is there, with the dot.
  const live = page.getByTestId("tab-live");
  await expect(live).toBeVisible();
  await expect(bar.getByRole("link")).toHaveText(["Jogos", "Múltiplas", "Ao vivo", "Banca", "Conta"]);
  await expect(bar.getByRole("link", { name: "Jogos" })).toHaveAttribute("aria-current", "page");
  // Fixed to the viewport's bottom edge, every tab at least 44px tall.
  const viewport = page.viewportSize()!;
  const box = (await bar.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(viewport.height);
  for (const tab of await bar.getByRole("link").all()) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // The main column keeps the bar's height free: the footer's last line is reachable above it.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const footer = (await page.locator("footer").last().boundingBox())!;
  expect(footer.y + footer.height).toBeLessThanOrEqual(box.y + 1);
  await live.click();
  await expect(page).toHaveURL(/\/app\/game\/990000102/);
  await expect(page.getByTestId("tab-live")).toHaveAttribute("aria-current", "page");
  await bar.getByRole("link", { name: "Banca" }).click();
  await expect(page).toHaveURL(/\/app\/bankroll/);
  await expect(page.getByTestId("tab-bar").getByRole("link", { name: "Banca" })).toHaveAttribute("aria-current", "page");
  // A sport with nothing in play has four tabs.
  await page.goto("/app?sport=soccer-esp&lang=pt&date=20260911");
  await expect(page.getByTestId("tab-bar").getByRole("link")).toHaveCount(4);
});

test("the slate is a list of tappable cards on a phone, the table stays for the desk", async ({ page }) => {
  await registerUser(page, "cards");
  await skipTour(page);
  await page.goto("/app?sport=wnba&lang=pt");
  const cards = page.getByTestId("game-card");
  await expect(cards).toHaveCount(4);
  await expect(page.getByTestId("game-cards")).toBeVisible();
  await expect(page.locator("table")).toBeHidden();
  const live = page.locator('[data-testid="game-card"][data-status="live"]');
  await expect(live).toHaveCount(1);
  await expect(live).toContainText("Dunas");
  await expect(live).toContainText("61");
  await expect(live.locator(".live-dot")).toBeVisible();
  // The three market numbers, and a card tall enough for a thumb.
  const scheduled = page.locator('[data-testid="game-card"][data-status="scheduled"]').first();
  await expect(scheduled).toContainText("Handicap");
  await expect(scheduled).toContainText("Total");
  await expect(scheduled).toContainText("Vencedor");
  expect((await scheduled.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await scheduled.click();
  await expect(page).toHaveURL(/\/app\/game\/9900001\d\d\?sport=wnba&lang=pt/);
});

test("the game page: a compact head once the team block scrolls away, and one primary action in a bottom bar", async ({ page }) => {
  const { email } = await registerUser(page, "phonegame");
  await setPlan(email, "pro");
  await skipTour(page);
  await page.goto("/app/game/990000102?sport=wnba&lang=pt");
  await expect(page.getByTestId("live-panel")).toBeVisible({ timeout: 30_000 });
  const head = page.getByTestId("game-sticky-head");
  await expect(head).toHaveAttribute("data-shown", "false");
  await page.evaluate(() => window.scrollTo(0, 800));
  await expect(head).toHaveAttribute("data-shown", "true");
  await expect(head).toBeVisible();
  await expect(head.getByTestId("sticky-score")).toHaveText("61 × 58");
  // The live read is offered in the bar while its inline button is off screen, and only then.
  const bar = page.getByTestId("game-action-bar");
  await expect(bar.getByTestId("action-live-read")).toHaveText("Pedir leitura ao vivo");
  expect((await bar.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByTestId("live-read-btn").scrollIntoViewIfNeeded();
  await expect(bar).toBeHidden();
  // Odds bands as chips a thumb can swipe: pressing one leaves that band's tickets alone on screen.
  const chips = page.getByTestId("band-chips").getByRole("button");
  await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
  const tickets = page.getByTestId("ticket");
  const all = await tickets.count();
  await chips.nth(1).click();
  await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
  const visible = await tickets.evaluateAll((els) => els.filter((el) => (el as HTMLElement).offsetParent !== null).length);
  expect(visible).toBeGreaterThan(0);
  expect(visible).toBeLessThan(all);
  await chips.first().click();
  await expect(tickets.first()).toBeVisible();
  // Every ticket is a full-width card on the phone.
  const width = await page.evaluate(() => window.innerWidth);
  expect((await tickets.first().boundingBox())!.width).toBeGreaterThan(width * 0.8);
});

test("the tickets panel offers 'Ver bilhetes' from the bottom of the page and scrolls back to it", async ({ page }) => {
  await registerUser(page, "phonetickets");
  await skipTour(page);
  await page.goto("/app/game/401882878?sport=soccer-esp&lang=pt");
  await expect(page.getByTestId("ticket").first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const action = page.getByTestId("action-see-tickets");
  await expect(action).toHaveText("Ver bilhetes");
  await action.click();
  await expect(page.getByTestId("game-action-bar")).toBeHidden();
  const panel = (await page.getByTestId("tickets").boundingBox())!;
  expect(panel.y).toBeGreaterThanOrEqual(0);
  expect(panel.y).toBeLessThan(200);
});
