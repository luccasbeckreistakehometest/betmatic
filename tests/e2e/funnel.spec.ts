import { test, expect } from "@playwright/test";
import { registerUser, skipTour } from "./helpers";

/** A real upcoming game ESPN lists today (the pick rules only apply before kickoff). */
async function upcomingGame(page: import("@playwright/test").Page): Promise<{ id: string; sport: string } | null> {
  for (const sport of ["soccer-bra", "wnba", "soccer-eng", "soccer-esp", "nba"]) {
    const slate = await page.request.get(`/api/slate?sport=${sport}`).then((r) => r.json());
    const game = (slate.games ?? []).find((g: { id: string; status: string; startsAt: string }) => g.status === "scheduled" && Date.parse(g.startsAt) > Date.now() + 10 * 60_000);
    if (game) return { id: game.id, sport };
  }
  return null;
}

test("a free user's daily pick is spent only on an upcoming game that ends up with tickets", async ({ page }) => {
  await registerUser(page, "free");
  await skipTour(page);
  const picks = async () => (await page.request.get("/api/predictions?sport=soccer-esp&lang=pt").then((r) => r.json())).unlocked.map((g: { gameId: string }) => g.gameId);

  // A finished game shows its tickets (public since kickoff) and costs nothing.
  await page.goto("/app/game/401882878?sport=soccer-esp&lang=pt");
  await expect(page.getByTestId("ticket-bankroll").first()).toBeVisible();
  const served = await page.request.get("/api/predictions?sport=soccer-esp&date=20260911&lang=pt").then((r) => r.json());
  expect(served.predictions.map((p: { gameId: string }) => p.gameId)).toEqual(["401882878"]);
  // Free plan: value band only.
  expect(served.predictions[0].slate.suggestions.every((s: { bandKey: string }) => s.bandKey === "value")).toBe(true);
  expect((await page.request.post("/api/game/401882878/generate?sport=soccer-esp").then((r) => r.json())).status).toBe("exists");
  expect(await picks()).toEqual([]);

  // Opening an upcoming game asks first; browsing spends nothing.
  const other = await upcomingGame(page);
  expect(other, "ESPN listed no upcoming game to try").not.toBeNull();
  await page.goto(`/app/game/${other!.id}?sport=${other!.sport}&lang=pt`);
  await expect(page.getByTestId("daily-pick")).toBeVisible();
  expect(await picks()).toEqual([]);
  // No AI in the suite: the generation cannot run, and the pick comes back.
  await page.getByTestId("use-daily-pick").click();
  await expect(page.getByText("A geração está desligada neste servidor.")).toBeVisible();
  expect(await picks()).toEqual([]);

  // An upcoming game with tickets ready becomes the pick; a second one is then refused, naming it.
  const chosen = await page.request.post("/api/game/990000001/generate?sport=soccer-esp").then((r) => r.json());
  expect(chosen.status).toBe("exists");
  expect(await picks()).toEqual(["990000001"]);
  const todays = await page.request.get(`/api/predictions?sport=soccer-esp&date=${chosen.dateKey}&lang=pt`).then((r) => r.json());
  expect(todays.predictions.map((p: { gameId: string }) => p.gameId)).toContain("990000001");
  const second = await page.request.post(`/api/game/${other!.id}/generate?sport=${other!.sport}`).then((r) => r.json());
  expect(second.status).toBe("cap_user");
  expect(second.unlocked[0].gameId).toBe("990000001");
  await page.goto(`/app/game/${other!.id}?sport=${other!.sport}&lang=pt`);
  await expect(page.getByTestId("cap-user")).toBeVisible();
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
