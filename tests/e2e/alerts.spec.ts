import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { loginAdmin, skipTour } from "./helpers";

const outbox = () => {
  const file = path.join(process.cwd(), "data", "e2e", "telegram-outbox.jsonl");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { chatId: string; text: string }) : [];
};

test("telegram: a one-time code links the chat through the bot webhook, and the digest reaches it", async ({ page }) => {
  await loginAdmin(page);
  await skipTour(page);
  await page.goto("/app/alerts?lang=pt");
  await expect(page.getByTestId("telegram-status")).toHaveAttribute("data-linked", "0");
  await page.getByTestId("telegram-connect").click();
  const code = (await page.getByTestId("telegram-code").innerText()).trim();
  expect(code).toMatch(/^[A-Z2-9]{8}$/);
  await expect(page.getByTestId("telegram-open")).toHaveAttribute("href", `https://t.me/betmatic_e2e_bot?start=${code}`);

  // the bot receives /start <code> from chat 4242
  const bad = await page.request.post("/api/telegram/webhook", { data: { message: { chat: { id: 4242 }, from: { username: "luccas" }, text: "/start ZZZZZZZZ" } } });
  expect((await bad.json()).action).toBe("badCode");
  const ok = await page.request.post("/api/telegram/webhook", { data: { message: { chat: { id: 4242 }, from: { username: "luccas" }, text: `/start ${code}` } } });
  expect((await ok.json()).action).toBe("linked");
  expect(outbox().some((m) => m.chatId === "4242" && /Conta conectada/.test(m.text))).toBe(true);

  await page.getByTestId("telegram-refresh").click();
  await expect(page.getByTestId("telegram-status")).toHaveAttribute("data-linked", "1");
  await expect(page.getByTestId("digest-toggle")).toBeChecked();

  // the digest for the seeded slate goes to the linked chat, whitelabelled, once
  const digest = await page.request.post("/api/cron/refresh?job=digest&date=20260911");
  expect(await digest.json()).toMatchObject({ job: "digest", users: 1, telegram: 1 });
  const msg = outbox().find((m) => m.chatId === "4242" && /Seus bilhetes de hoje/.test(m.text));
  expect(msg).toBeTruthy();
  expect(msg!.text).toContain("Valencia @ Sevilla");
  expect(msg!.text).toContain("/p/");
  expect(msg!.text).not.toMatch(/Betano|ESPN/);
  const again = await page.request.post("/api/cron/refresh?job=digest&date=20260911");
  expect((await again.json()).users).toBe(0);

  await page.getByTestId("telegram-unlink").click();
  await expect(page.getByTestId("telegram-status")).toHaveAttribute("data-linked", "0");
});

test("follows: leagues from the alerts page, teams from the game page; the webhook is hidden without a token elsewhere", async ({ page }) => {
  await loginAdmin(page);
  await skipTour(page);
  await page.goto("/app/alerts?lang=pt");
  const laliga = page.getByTestId("league-soccer-esp");
  await expect(laliga).toHaveAttribute("data-on", "0");
  await laliga.click();
  await expect(laliga).toHaveAttribute("data-on", "1");
  const state = await page.request.get("/api/alerts").then((r) => r.json());
  expect(state.follows).toEqual([expect.objectContaining({ kind: "league", sportKey: "soccer-esp", key: "soccer-esp" })]);

  // a team, straight from the API the game-page button uses
  const followed = await page.request.post("/api/alerts", { data: { action: "follow", kind: "team", sportKey: "soccer-esp", key: "243", label: "Sevilla" } });
  expect(followed.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("followed-teams")).toContainText("Sevilla");
  await page.getByTestId("followed-teams").getByRole("button").click();
  await expect(page.getByTestId("followed-teams")).toBeHidden();
  await laliga.click();
  await expect(laliga).toHaveAttribute("data-on", "0");
});

test("in-app notifications are the fallback when Telegram is not linked", async ({ page, request }) => {
  const email = `nina${Date.now()}@example.com`;
  const reg = await page.request.post("/api/auth/register", { data: { name: "Nina", email, password: "password123", lang: "pt", acceptTerms: true } });
  expect(reg.ok()).toBeTruthy();
  await skipTour(page);
  await page.request.post("/api/alerts", { data: { action: "digest", on: true } });
  expect((await page.request.post("/api/cron/refresh?job=digest&date=20260911")).status()).toBe(401); // cron is admin- or secret-only
  expect((await request.get("/api/alerts")).status()).toBe(401); // anonymous

  // the admin runs the digest for the seeded day; Nina has no chat, so it lands in her in-app list
  await page.context().clearCookies();
  await loginAdmin(page);
  const j = await page.request.post("/api/cron/refresh?job=digest&date=20260911").then((r) => r.json());
  expect(j.inapp).toBeGreaterThanOrEqual(1);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill("password123");
  await page.getByTestId("auth-submit").click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto("/app/alerts?lang=pt");
  const first = page.getByTestId("notifications").getByTestId("notification").first();
  await expect(first).toHaveAttribute("data-status", "unread");
  await expect(first).toContainText("Seus bilhetes de hoje");
  await expect(first).not.toContainText(/Betano|ESPN/);
  await page.getByTestId("mark-read").click();
  await expect(page.getByTestId("mark-read")).toBeHidden();
  await expect(first).toHaveAttribute("data-status", "read");
});
