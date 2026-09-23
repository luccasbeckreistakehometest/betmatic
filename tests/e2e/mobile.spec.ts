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

test("the tab bar sits at the bottom, names the game under way, is right on first paint, and marks where you are", async ({ page }) => {
  await registerUser(page, "tabs");
  await skipTour(page);
  await page.goto("/app?sport=wnba&lang=pt");
  const bar = page.getByTestId("tab-bar");
  await expect(bar).toBeVisible();
  // The WNBA slate has a game in play: a fifth tab named by the two teams, with the live dot.
  const live = page.getByTestId("tab-live");
  await expect(live).toBeVisible();
  await expect(live).toHaveAttribute("aria-label", "Ao vivo: Dunas Divers × Cedro Comets");
  // "Hoje" leads, and nothing was dropped to make room for it: the bar grows to six columns.
  await expect(bar.getByRole("link")).toHaveText(["Hoje", "Jogos", "Múltiplas", "DUN × CED", "Banca", "Conta"]);
  // The shell decides the live tab on the server (from the remembered sport), so the HTML already
  // carries every tab and nothing moves under the thumb after first paint.
  const html = await page.request.get("/app?sport=wnba&lang=pt").then((r) => r.text());
  expect(html).toContain('data-testid="tab-live"');
  await page.goto("/app?sport=wnba&lang=pt", { waitUntil: "commit" });
  await page.locator('[data-testid="tab-bar"]').waitFor({ state: "attached" });
  const first = await page.locator('[data-testid="tab-bar"] a').count();
  await page.waitForTimeout(1500);
  expect(first).toBe(6);
  expect(await page.locator('[data-testid="tab-bar"] a').count()).toBe(6);
  // The current tab carries the rail's cue: a 2px rule in ink on its top edge, never a hue.
  const current = bar.getByRole("link", { name: "Jogos" });
  await expect(current).toHaveAttribute("aria-current", "page");
  expect(await current.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/rgb\(237, 240, 245\).*inset/);
  // Fixed to the viewport's bottom edge, every tab at least 44px tall, and the token that reserves
  // its room is the bar's real height.
  const viewport = page.viewportSize()!;
  const box = (await bar.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(viewport.height);
  for (const tab of await bar.getByRole("link").all()) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const reserved = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tabbar-h"));
  expect(reserved.replace(/\s/g, "")).toBe("calc(56px+1px+0px)");
  // The main column keeps the bar's height free: the footer's last line is reachable above it.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const footer = (await page.locator("footer").last().boundingBox())!;
  expect(footer.y + footer.height).toBeLessThanOrEqual(box.y + 0.5);
  await live.click();
  await expect(page).toHaveURL(/\/app\/game\/990000102/);
  await expect(page.getByTestId("tab-live")).toHaveAttribute("aria-current", "page");
  await bar.getByRole("link", { name: "Banca" }).click();
  await expect(page).toHaveURL(/\/app\/bankroll/);
  await expect(page.getByTestId("tab-bar").getByRole("link", { name: "Banca" })).toHaveAttribute("aria-current", "page");
  // A sport with nothing in play drops the live tab and keeps the other five.
  await page.goto("/app?sport=soccer-esp&lang=pt&date=20260911");
  await expect(page.getByTestId("tab-bar").getByRole("link")).toHaveCount(5);
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
  // The three market numbers, whole — a number is never cut short — and a card tall enough for a thumb.
  const scheduled = page.locator('[data-testid="game-card"][data-status="scheduled"]').first();
  await expect(scheduled).toContainText("Handicap");
  await expect(scheduled).toContainText("Total");
  await expect(scheduled).toContainText("Vencedor");
  const clipped = await scheduled.locator(".nums").evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
  expect(clipped).toEqual([]);
  expect((await scheduled.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await scheduled.click();
  await expect(page).toHaveURL(/\/app\/game\/9900001\d\d\?sport=wnba&lang=pt/);
});

test("the game page: a compact head once the team block scrolls away, and one primary action for the page's state", async ({ page }) => {
  const { email } = await registerUser(page, "phonegame");
  await setPlan(email, "pro");
  await skipTour(page);
  await page.goto("/app/game/990000102?sport=wnba&lang=pt");
  await expect(page.getByTestId("live-panel")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("ticket").first()).toBeVisible({ timeout: 30_000 });
  // At the top the full team block is on screen, so the compact head is off (hidden and moved away).
  const head = page.getByTestId("game-sticky-head");
  await expect(head).toHaveAttribute("data-shown", "false");
  expect(await head.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
  // The bar shows the one action for this state: the live read while this reader can still ask for
  // one (the game's shared read may already have been taken earlier in the run — the panel then
  // shows the cooldown and no button), else the tickets. Its own control is off screen either way.
  const canRead = (await page.getByTestId("live-read-btn").count()) > 0;
  const expected = canRead ? "Pedir leitura ao vivo" : "Ver bilhetes";
  const bar = page.getByTestId("game-action-bar");
  await expect(bar).toHaveAttribute("data-shown", "true");
  await expect(bar.getByRole("button")).toHaveText(expected);
  const barBox = (await bar.boundingBox())!;
  expect(barBox.height).toBeGreaterThanOrEqual(44);
  const tabs = (await page.getByTestId("tab-bar").boundingBox())!;
  expect(Math.round(barBox.y + barBox.height)).toBeLessThanOrEqual(Math.round(tabs.y) + 1);
  // Once the team block has scrolled under the topbar, the compact head takes over with the score,
  // drawn right under the topbar.
  await page.evaluate(() => window.scrollTo(0, 800));
  await expect(head).toHaveAttribute("data-shown", "true");
  await expect.poll(() => head.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  const topbar = (await page.locator("header").first().boundingBox())!;
  expect(Math.round((await head.boundingBox())!.y)).toBe(Math.round(topbar.y + topbar.height));
  await expect(head.getByTestId("sticky-score")).toHaveText("61 × 58");
  // The label never changes while scrolling: the same action at every position, shown or (while
  // its own control is on screen) held invisible — never another one. The button is read as CSS,
  // because a held bar is hidden from the accessibility tree on purpose.
  for (const y of [1200, 1600, 2000]) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(150);
    await expect(bar.locator("button")).toHaveText(expected);
  }
  // At the end of the page the bar rests in flow above the footer: the 18+ line is never covered,
  // and the page's height did not change on the way (its slot stays while the action exists).
  const before = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(before);
  const footer = (await page.locator("footer").last().boundingBox())!;
  const slot = await bar.evaluate((el) => { const r = el.getBoundingClientRect(); return { y: r.y, h: r.height }; });
  expect(slot.y + slot.h).toBeLessThanOrEqual(footer.y + 1);
  expect(Math.round(footer.y + footer.height)).toBeLessThanOrEqual(Math.round(tabs.y) + 1);
  // The bar steps aside as soon as the control it stands for is on screen: one primary action at a time.
  const twin = canRead ? page.getByTestId("live-read-btn") : page.locator("#tickets");
  await twin.scrollIntoViewIfNeeded();
  await expect(bar).toBeHidden();
  // Odds bands as chips a thumb can swipe, resting on the tickets' own edge; pressing one leaves
  // that band's tickets alone on screen.
  const chips = page.getByTestId("band-chips").getByRole("button");
  await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
  const tickets = page.getByTestId("ticket");
  const chipBox = (await chips.first().boundingBox())!;
  const ticketBox = (await tickets.first().boundingBox())!;
  expect(Math.abs(chipBox.x - ticketBox.x)).toBeLessThanOrEqual(1);
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
  // The scroll is smooth: wait for it to settle with the panel's top just under the sticky chrome.
  const top = () => page.locator("#tickets").boundingBox().then((b) => b!.y);
  await expect.poll(top, { timeout: 5_000 }).toBeGreaterThanOrEqual(0);
  expect(await top()).toBeLessThan(200);
});

test("installed on a phone with a notch, the chrome clears the status bar and the home indicator", async ({ page }) => {
  const { email } = await registerUser(page, "insets");
  await setPlan(email, "pro");
  await skipTour(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 47, bottom: 34, left: 0, right: 0 } });
  await page.goto("/app/game/990000102?sport=wnba&lang=pt");
  await expect(page.getByTestId("live-panel")).toBeVisible({ timeout: 30_000 });
  // The topbar is drawn below the 47px status bar; everything that sticks under it follows.
  const header = (await page.locator("header").first().boundingBox())!;
  expect(Math.round(header.y)).toBe(0);
  expect(Math.round(header.height)).toBe(48 + 47);
  await page.evaluate(() => window.scrollTo(0, 800));
  const head = page.getByTestId("game-sticky-head");
  await expect(head).toHaveAttribute("data-shown", "true");
  expect(Math.round((await head.boundingBox())!.y)).toBe(48 + 47);
  // The tabs sit above the 34px home indicator, and the room reserved for them says so.
  const tabs = page.getByTestId("tab-bar");
  const tabsBox = (await tabs.boundingBox())!;
  const inner = await page.evaluate(() => window.innerHeight);
  expect(Math.round(tabsBox.height)).toBe(56 + 1 + 34);
  const link = (await tabs.getByRole("link").first().boundingBox())!;
  expect(Math.round(link.y + link.height)).toBeLessThanOrEqual(inner - 34);
  const reserved = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tabbar-h"));
  expect(reserved.replace(/\s/g, "")).toBe("calc(56px+1px+34px)");
});
