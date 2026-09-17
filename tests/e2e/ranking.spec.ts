import { test, expect } from "@playwright/test";
import { skipTour } from "./helpers";

async function member(page: import("@playwright/test").Page, name: string) {
  const email = `${name}${Date.now()}@example.com`;
  expect((await page.request.post("/api/auth/register", { data: { name, email, password: "password123", lang: "pt" } })).ok()).toBeTruthy();
  await skipTour(page);
  return email;
}
async function graded(page: import("@playwright/test").Page, won: number, lost: number) {
  for (let i = 0; i < won + lost; i++) {
    const { entry } = await page.request.post("/api/bankroll", { data: { kind: "manual", title: `Aposta ${i}`, odds: 2, stake: 10 } }).then((r) => r.json());
    await page.request.patch("/api/bankroll", { data: { id: entry.id, outcome: i < won ? "won" : "lost" } });
  }
}
async function login(page: import("@playwright/test").Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill("password123");
  await page.getByTestId("auth-submit").click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("the leaderboard shows only members who opted in, with ten decided bets, under a handle", async ({ page, request }) => {
  expect((await request.get("/api/ranking")).status()).toBe(401);
  const stamp = Date.now().toString(36).slice(-4);

  // ten decided bets but no consent → invisible
  const silent = await member(page, "quieto");
  await graded(page, 8, 2);

  // nine decided bets with consent → below the minimum
  await member(page, "nove");
  await page.request.patch("/api/settings", { data: { leaderboardOptIn: true, handle: `nove_${stamp}` } });
  await graded(page, 9, 0);

  // ten decided with consent → ranked: 7W 3L at 2.00 on R$10 = +40% ROI, +4u
  const ranked = await member(page, "rank");
  const opt = await page.request.patch("/api/settings", { data: { leaderboardOptIn: true, handle: `Rankeiro_${stamp}` } });
  expect((await opt.json()).settings.handle).toBe(`rankeiro_${stamp}`);
  expect((await page.request.patch("/api/settings", { data: { handle: `nove_${stamp}` } })).status()).toBe(409); // taken
  expect((await page.request.patch("/api/settings", { data: { handle: "no spaces!" } })).status()).toBe(400);
  await graded(page, 7, 3);

  await page.goto("/app/ranking?lang=pt");
  const table = page.getByTestId("ranking-table");
  await expect(table).toBeVisible();
  await expect(page.getByTestId("ranking-row")).toHaveCount(1);
  const me = page.getByTestId("ranking-row").first();
  await expect(me).toHaveAttribute("data-you", "1");
  await expect(me).toContainText(`@rankeiro_${stamp}`);
  await expect(me).toContainText("7W 3L");
  await expect(me).toContainText("+40.0%");
  await expect(me).toContainText("+4.00u");
  await expect(page.getByTestId("ranking-not-in")).toBeHidden();
  await page.getByTestId("period-all").click();
  await expect(page.getByTestId("ranking-row")).toHaveCount(1);
  const body = await page.content();
  expect(body).not.toContain("quieto");
  expect(body).not.toContain("nove_");
  expect(body).not.toContain("@example.com");

  // opting out removes the row at once
  await page.request.patch("/api/settings", { data: { leaderboardOptIn: false } });
  await page.reload();
  await expect(page.getByTestId("ranking-empty")).toBeVisible();
  await expect(page.getByTestId("ranking-not-in")).toBeVisible();

  // the silent member sees the board too, but is not on it and is told how to join
  await login(page, silent);
  await page.goto("/app/ranking?lang=pt");
  await expect(page.getByTestId("ranking-not-in")).toBeVisible();
  void ranked;
});
