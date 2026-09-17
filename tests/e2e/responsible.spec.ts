import { test, expect } from "@playwright/test";
import { skipTour } from "./helpers";

async function freshUser(page: import("@playwright/test").Page, name: string) {
  const email = `${name}${Date.now()}@example.com`;
  const reg = await page.request.post("/api/auth/register", { data: { name, email, password: "password123", lang: "pt" } });
  expect(reg.ok()).toBeTruthy();
  await skipTour(page);
  return email;
}

test("stake ceilings cap the bankroll; the losing-streak notice and the session reminder show up", async ({ page }) => {
  await freshUser(page, "limite");
  await page.goto("/app/settings?lang=pt");
  await page.getByTestId("cap-daily").fill("100");
  await page.getByTestId("cap-weekly").fill("250");
  await page.getByTestId("limits-save").click();
  await expect(page.getByTestId("limits-saved")).toBeVisible();

  const over = await page.request.post("/api/bankroll", { data: { kind: "manual", title: "Grande demais", odds: 2, stake: 150 } });
  expect(over.status()).toBe(422);
  expect(await over.json()).toMatchObject({ error: "limit", reason: "daily", remainingDaily: 100 });
  for (const t of ["A", "B", "C"]) expect((await page.request.post("/api/bankroll", { data: { kind: "manual", title: `Aposta ${t}`, odds: 2, stake: 30 } })).ok()).toBeTruthy();
  const fourth = await page.request.post("/api/bankroll", { data: { kind: "manual", title: "Aposta D", odds: 2, stake: 20 } });
  expect(await fourth.json()).toMatchObject({ reason: "daily", remainingDaily: 10 });
  // the UI explains the refusal with what is left
  await page.goto("/app/bankroll?lang=pt");
  await page.getByTestId("manual-title").fill("Aposta E");
  await page.getByTestId("manual-odds").fill("1.90");
  await page.getByTestId("manual-stake").fill("50");
  await page.getByTestId("manual-add").click();
  await expect(page.getByTestId("add-error")).toContainText("restam R$ 10.00");

  // three losses in a row → the notice (default threshold 3)
  const { entries } = await page.request.get("/api/bankroll").then((r) => r.json());
  for (const e of entries) await page.request.patch("/api/bankroll", { data: { id: e.id, outcome: "lost" } });
  await page.reload();
  await expect(page.getByTestId("streak-notice")).toContainText("3 perdidas seguidas");
  await page.request.patch("/api/settings", { data: { lossStreakNotice: 5 } });
  await page.reload();
  await expect(page.getByTestId("streak-notice")).toBeHidden();

  // session reminder: a 1-minute interval, with a session that started 2 minutes ago
  await page.request.patch("/api/settings", { data: { sessionReminderMinutes: 1 } });
  await page.evaluate(() => { sessionStorage.setItem("bm_session_start", String(Date.now() - 2 * 60_000)); sessionStorage.removeItem("bm_reminder_shown"); });
  await page.reload();
  await expect(page.getByTestId("session-reminder")).toContainText("2 min");
  await page.getByTestId("reminder-dismiss").click();
  await expect(page.getByTestId("session-reminder")).toBeHidden();

  // the footer says it plainly on every app page
  await expect(page.getByTestId("not-investment")).toContainText("Aposta não é investimento");
});

test("a 7-day pause hides tickets, blocks the bankroll and cannot be lifted early", async ({ page }) => {
  await freshUser(page, "pausa");
  await page.goto("/app/settings?lang=pt");
  await expect(page.getByTestId("pause-7")).toBeDisabled();
  await page.getByTestId("pause-confirm").check();
  await page.getByTestId("pause-7").click();
  await expect(page.getByTestId("pause-banner").first()).toContainText("Pausa ativa até");
  const s = await page.request.get("/api/settings").then((r) => r.json());
  expect(s.pause.paused).toBe(true);
  expect(s.pause.daysLeft).toBe(7);

  // tickets are hidden, generation and the bankroll are locked
  const preds = await page.request.get("/api/predictions?sport=soccer-esp&date=20260911&lang=pt").then((r) => r.json());
  expect(preds.predictions).toEqual([]);
  expect(preds.paused.until).toBe(s.pause.until);
  expect((await page.request.post("/api/bankroll", { data: { kind: "manual", title: "Aposta na pausa", odds: 2, stake: 1 } })).status()).toBe(423);
  expect((await page.request.post("/api/game/401882878/generate?sport=soccer-esp")).status()).toBe(423);
  await page.goto("/app?lang=pt");
  await expect(page.getByTestId("pause-banner")).toContainText("bilhetes escondidos");
  await page.goto("/app/bankroll?lang=pt");
  await expect(page.getByTestId("manual-add")).toBeDisabled();

  // no way to end it early: the endpoint only ever extends
  const again = await page.request.post("/api/settings/pause", { data: { days: 30 } }).then((r) => r.json());
  expect(again.pause.daysLeft).toBe(30);
  expect((await page.request.post("/api/settings/pause", { data: { days: 1 } })).status()).toBe(400);
  const stillPaused = await page.request.patch("/api/settings", { data: { dailyStakeCap: null } }).then((r) => r.json());
  expect(stillPaused.pause.paused).toBe(true);
  // the public pages stay open — a pause is about betting, not about reading the record
  expect((await page.request.get("/prova?lang=pt")).ok()).toBeTruthy();
});
