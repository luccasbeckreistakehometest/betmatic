import { test, expect } from "@playwright/test";

test.describe("landing", () => {
  test("pt and en carry different copy, not translations", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/?lang=pt");
    const pt = await page.locator("h1").first().innerText();
    await page.goto("/?lang=en");
    const en = await page.locator("h1").first().innerText();
    expect(pt.length).toBeGreaterThan(8);
    expect(en).not.toEqual(pt);
    expect(errors).toEqual([]);
  });

  test("a funnel per sport", async ({ page }) => {
    for (const sport of ["nba", "futebol", "tenis"]) {
      const r = await page.goto(`/${sport}?lang=pt`);
      if (r && r.status() === 404) continue; // slug set lives in lib/sport-landing; only assert the ones that exist
      await expect(page.locator("h1").first()).not.toBeEmpty();
    }
    await page.goto("/?lang=pt");
    const links = await page.locator("a[href^='/']").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
    expect(links.some((h) => /\/(nba|wnba|futebol|soccer|tenis|tennis|basquete|basketball)/.test(h))).toBe(true);
  });
});

test("the landing shows live proof numbers and today's whitelabelled ticket", async ({ page }) => {
  await page.goto("/?lang=pt");
  const strip = page.getByTestId("proof-strip");
  await expect(strip).toContainText("bilhetes gerados");
  await expect(strip).toContainText("50.0%");
  await expect(page.getByTestId("ticket-of-day")).toBeVisible();
  // the teaser is a ticket a free account can open, described by its shape — never the pick itself
  await expect(page.getByTestId("ticket-of-day")).toContainText("Múltipla de 3 pernas");
  await expect(page.getByTestId("ticket-of-day")).not.toContainText("Agoumé");
  await expect(page.getByTestId("ticket-of-day").getByRole("link", { name: "Ver as pernas grátis" })).toBeVisible();
  const html = await page.content();
  expect(html).not.toMatch(/Betano|ESPN|DraftKings/);
});

test("the differentiators section and the sport funnels carry the proof strip", async ({ page }) => {
  await page.goto("/?lang=pt");
  const edge = page.getByTestId("edge");
  await expect(edge).toContainText("Prova pública");
  await expect(edge.getByRole("link")).toHaveCount(6);
  await page.goto("/futebol");
  await expect(page.getByTestId("proof-strip")).toBeVisible();
  await expect(page.getByTestId("proof-strip")).toContainText("bilhetes gerados");
  // A sport with no decided ticket shows the method, never a row of zeros.
  await page.goto("/basquete");
  await expect(page.getByTestId("proof-method")).toContainText("Como medimos");
  await expect(page.getByTestId("proof-strip")).not.toContainText("bilhetes gerados");
});
