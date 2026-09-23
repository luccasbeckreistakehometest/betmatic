import { test, expect } from "@playwright/test";
import { loginAdmin, registerUser, skipTour } from "./helpers";

test("analytics: a WhatsApp visit that signs up and opens a game shows in the admin funnel", async ({ page, browser }) => {
  const landed = page.waitForResponse((r) => r.url().endsWith("/api/e") && r.status() === 204);
  await page.goto("/?utm_source=whatsapp&utm_campaign=teste-e2e");
  await landed;
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "bm_aid")?.httpOnly).toBe(true);
  expect(cookies.find((c) => c.name === "bm_ft")?.value).toContain("whatsapp");

  await registerUser(page, "utm");
  await skipTour(page);
  const opened = page.waitForResponse((r) => r.url().endsWith("/api/e") && r.status() === 204);
  await page.goto("/app/game/990000103?sport=wnba&lang=pt");
  await opened;

  // An unknown event name is refused.
  expect((await page.request.post("/api/e", { data: { name: "drop_everything" } })).status()).toBe(400);

  const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3300", locale: "pt-BR" });
  const admin = await ctx.newPage();
  await loginAdmin(admin);
  await admin.goto("/admin");
  const panel = admin.getByTestId("admin-acquisition");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  const row = panel.getByTestId("acq-funnel").locator("tr", { hasText: "whatsapp" });
  await expect(row).toBeVisible();
  const cells = await row.locator("td").allTextContents();
  expect(Number(cells[1])).toBeGreaterThanOrEqual(1);
  expect(cells[2]).toMatch(/^1\b/);
  expect(cells[3]).toBe("1");
  await admin.getByLabel("utm_campaign").fill("rodada-26");
  await expect(admin.getByTestId("utm-link")).toContainText("utm_source=whatsapp&utm_medium=social&utm_campaign=rodada-26");
  await ctx.close();
});
