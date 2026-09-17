import { test, expect } from "@playwright/test";
import { registerUser, skipTour } from "./helpers";

test("a free user sees the ticket of the game they opened, and that game is their pick for the day", async ({ page }) => {
  await registerUser(page, "free");
  await skipTour(page);
  await page.goto("/app/game/401882878?sport=soccer-esp&lang=pt");
  // The seeded ticket exists, so opening the game unlocks it and shows it right away.
  await expect(page.getByTestId("ticket-bankroll").first()).toBeVisible();
  const served = await page.request.get("/api/predictions?sport=soccer-esp&date=20260911&lang=pt").then((r) => r.json());
  expect(served.predictions.map((p: { gameId: string }) => p.gameId)).toEqual(["401882878"]);
  expect(served.unlocked.map((g: { gameId: string }) => g.gameId)).toEqual(["401882878"]);
  // Free plan: value band only.
  expect(served.predictions[0].slate.suggestions.every((s: { bandKey: string }) => s.bandKey === "value")).toBe(true);

  // A second game the same day is refused with the chosen one named, and nothing is generated.
  // Any other real game will do (the pick is per Brasília day, whatever the game's date).
  let other: { id: string; sport: string } | null = null;
  for (const sport of ["soccer-bra", "wnba", "soccer-eng", "nba"]) {
    const slate = await page.request.get(`/api/slate?sport=${sport}`).then((r) => r.json());
    const game = (slate.games ?? []).find((g: { id: string }) => g.id !== "401882878");
    if (game) { other = { id: game.id, sport }; break; }
  }
  expect(other, "ESPN listed no other game to try").not.toBeNull();
  const second = await page.request.post(`/api/game/${other!.id}/generate?sport=${other!.sport}`).then((r) => r.json());
  expect(second.status).toBe("cap_user");
  expect(second.unlocked[0].gameId).toBe("401882878");
  // A made-up id never burns the pick.
  expect((await page.request.post("/api/game/999999999/generate?sport=soccer-esp")).status()).toBe(404);
});

test("the app opens on a sport with games when none is given, and remembers the last one", async ({ page }) => {
  await skipTour(page);
  await page.goto("/app?lang=pt");
  await expect(page).toHaveURL(/sport=/);
  await page.goto("/app?sport=wnba&lang=pt");
  await page.waitForFunction(() => document.cookie.includes("bm_sport=wnba"));
  await page.goto("/app?lang=pt");
  await expect(page).toHaveURL(/sport=wnba/);
});

test("tennis pages load instead of 404 and say tennis tickets are not built", async ({ page }) => {
  const slate = await page.request.get("/api/slate?sport=tennis-wta").then((r) => r.json());
  const match = slate.games?.[0];
  test.skip(!match, "no WTA match on the calendar");
  await skipTour(page);
  const r = await page.goto(`/app/game/${match.id}?sport=tennis-wta&lang=pt`);
  expect(r?.status()).toBe(200);
  await expect(page.getByText("Ainda não montamos bilhetes de tênis")).toBeVisible();
  expect((await page.request.get("/tenis")).url()).not.toContain("/tenis");
});

test("sport funnels carry the sport into the app and signup keeps the return URL", async ({ page }) => {
  await page.goto("/futebol");
  await expect(page.getByTestId("sport-cta")).toHaveAttribute("href", /\/app\?sport=soccer-bra/);
  await skipTour(page);
  await page.goto("/app/game/401882878?sport=soccer-esp&lang=pt");
  const signup = page.getByTestId("signup-for-tickets");
  await expect(signup).toHaveAttribute("href", /next=%2Fapp%2Fgame%2F401882878/);
  await signup.click();
  await page.getByTestId("auth-name").fill("Volta");
  await page.getByTestId("auth-email").fill(`volta${Date.now()}@example.com`);
  await page.getByTestId("auth-password").fill("password123");
  await page.getByTestId("auth-consent").check();
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/app\/game\/401882878/);
});
