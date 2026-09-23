import { test, expect } from "@playwright/test";
import { loginAdmin } from "./helpers";

test("the public game page is an indexable, whitelabelled palpite with FAQ schema, and visiting it generates nothing", async ({ page, request }) => {
  await loginAdmin(page);
  const before = (await page.request.get("/api/admin").then((r) => r.json())).predictions.total;
  await page.context().clearCookies();

  await page.goto("/jogo/401882878?lang=pt");
  await expect(page.locator("h1")).toContainText("Palpite Valencia x Sevilla");
  // the teaser shows the free-band ticket's shape, never its title or legs
  await expect(page.getByTestId("game-teaser")).toContainText("Múltipla de 3 linhas · faixa Valor");
  await expect(page.getByTestId("game-teaser")).not.toContainText("Agoumé");
  await expect(page.getByTestId("game-proof")).toContainText(/50,0\s*%/); // this sport's live record
  const html = await page.content();
  expect(html).not.toMatch(/Betano|ESPN|DraftKings/);
  expect(html).not.toContain("1+ falta cometida"); // legs stay behind the signup
  expect(html).toContain('"@type":"FAQPage"');
  expect(html).toContain('"@type":"SportsEvent"');
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(/\/jogo\/401882878\?sport=soccer-esp$/);
  const hreflangs = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((ls) => ls.map((l) => l.getAttribute("hreflang")));
  expect(hreflangs).toEqual(expect.arrayContaining(["pt-BR", "en"]));
  await expect(page).toHaveTitle(/Palpite Valencia x Sevilla/);

  await page.goto("/jogo/401882878?lang=en");
  await expect(page.locator("h1")).toContainText("Valencia vs Sevilla prediction");
  expect((await request.get("/jogo/000000000")).status()).toBe(404);

  // a fixture ESPN knows nothing about still renders from the stored slate
  await page.goto("/jogo/990000001?lang=pt");
  await expect(page.locator("h1")).toContainText("Palpite Girona x Betis");

  // search surface: today's and tomorrow's slates are in the sitemap, robots allows the path
  const sm = await request.get("/sitemap.xml").then((r) => r.text());
  expect(sm).toContain("/jogo/990000001?sport=");
  expect(sm).not.toContain("/jogo/401882878"); // 11 Sep is neither today nor tomorrow
  expect(await request.get("/robots.txt").then((r) => r.text())).toContain("/jogo/");

  // read-only: no generation was triggered by any of those visits
  await loginAdmin(page);
  const after = (await page.request.get("/api/admin").then((r) => r.json())).predictions.total;
  expect(after).toBe(before);
});

test("the canonical carries the sport, so it never points at a page that 404s", async ({ page }) => {
  await page.goto("/jogo/401882878?lang=pt");
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonical).toMatch(/\/jogo\/401882878\?sport=soccer-esp$/);
  // Relative when NEXT_PUBLIC_BASE_URL is unset (as here); absolute in production.
  const res = await page.request.get(new URL(canonical!, page.url()).toString());
  expect(res.status()).toBe(200);
});
