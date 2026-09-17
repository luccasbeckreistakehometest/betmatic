import { test, expect } from "@playwright/test";
import { loginAdmin, loginAs, registerUser } from "./helpers";

test("costly and operator routes are closed to visitors and plain users", async ({ page }) => {
  const anon = page.request;
  expect((await anon.get("/api/slate-bets?sport=wnba")).status()).toBe(404);
  expect((await anon.get("/api/intel/401882878?sport=soccer-esp")).status()).toBe(403);
  expect((await anon.get("/api/intel/401882878/stream?sport=soccer-esp")).status()).toBe(403);
  expect((await anon.get("/api/sessions")).status()).toBe(403);
  expect((await anon.post("/api/ledger")).status()).toBe(403);
  expect((await anon.get("/api/admin")).status()).toBe(403);
  expect((await anon.get("/api/admin/users")).status()).toBe(403);
  expect((await anon.get("/api/admin/payments")).status()).toBe(403);
  expect((await anon.get("/api/admin/contact")).status()).toBe(403);
  expect((await anon.post("/api/cron/refresh?job=settle&secret=anything")).status()).toBe(401);
  expect((await anon.post("/api/game/401882878/generate?sport=soccer-esp")).status()).toBe(401);
  expect((await anon.post("/api/billing/checkout", { data: { kind: "coins", packId: "pack_50" } })).status()).toBe(401);

  await registerUser(page, "plain");
  expect((await page.request.get("/api/intel/401882878?sport=soccer-esp")).status()).toBe(403);
  expect((await page.request.get("/api/admin/users")).status()).toBe(403);
  expect((await page.request.post("/api/admin/users", { data: { action: "coins", userId: "x", delta: 100 } })).status()).toBe(403);
  expect((await page.request.post("/api/ledger")).status()).toBe(403);
});

test("visitors never see source names in the ledger API, the game API or its errors", async ({ page }) => {
  const ledger = await page.request.get("/api/ledger?entries=1").then((r) => r.json());
  expect(ledger.admin).toBe(false);
  expect(ledger.calibration.bySource).toBeUndefined();
  expect(ledger.specialisation).toBeUndefined();
  expect(JSON.stringify(ledger)).not.toMatch(/sourceBasis|book line|Betano|ESPN/i);
  expect(ledger.entries.length).toBeGreaterThan(0);

  const game = await page.request.get("/api/game/401882878?sport=soccer-esp");
  expect(game.ok()).toBeTruthy();
  expect(await game.text()).not.toMatch(/DraftKings|ESPN BET|Betano|bet365/i);
  const missing = await page.request.get("/api/game/000000001?sport=soccer-esp");
  expect(missing.status()).toBeGreaterThanOrEqual(400);
  expect(await missing.text()).not.toMatch(/espn|site\.api/i);
  const slate = await page.request.get("/api/slate?sport=nope&date=bad");
  expect(await slate.text()).not.toMatch(/site\.api\.espn/);

  await page.goto("/app/game/401882878?sport=soccer-esp&lang=pt");
  await expect(page.locator("h1, h2").first()).toBeVisible();
  expect(await page.content()).not.toMatch(/DraftKings|ESPN win prob|>ESPN</);

  await loginAdmin(page);
  const adminLedger = await page.request.get("/api/ledger").then((r) => r.json());
  expect(adminLedger.admin).toBe(true);
  expect(adminLedger.calibration.bySource).toBeDefined();
});

test("health is public and read-only; the tour GET writes nothing", async ({ page }) => {
  const health = await page.request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ ok: true, db: true });
  const tour = await page.request.get("/api/tour");
  expect(tour.headers()["set-cookie"]).toBeUndefined();
  expect(await tour.json()).toEqual({ tourCompleted: false, tourStep: 0 });
});

test("login failures are limited per account and answered in the reader's language", async ({ page }) => {
  const { email } = await registerUser(page, "brute");
  await page.context().clearCookies();
  const statuses: number[] = [];
  let last: { error?: string; message?: string } = {};
  for (let i = 0; i < 10; i++) {
    const r = await page.request.post("/api/auth/login?lang=en", { data: { email, password: `wrong-${i}` } });
    statuses.push(r.status());
    last = await r.json();
  }
  expect(statuses.slice(0, 8).every((s) => s === 401)).toBe(true);
  expect(statuses.slice(8)).toEqual([429, 429]);
  expect(last.error).toBe("rate_limited");
  expect(last.message).toMatch(/Too many attempts/);
  const pt = await page.request.post("/api/auth/login", { data: { email: "nobody@example.com", password: "x" }, headers: { "accept-language": "pt-BR" } });
  expect((await pt.json()).message).toBe("E-mail ou senha incorretos.");
});

test("signup requires the 18+/terms consent and ignores bots", async ({ page }) => {
  const missing = await page.request.post("/api/auth/register", { data: { name: "X", email: `x${Date.now()}@example.com`, password: "password123" } });
  expect(missing.status()).toBe(400);
  expect((await missing.json()).error).toBe("terms_required");
  const bot = await page.request.post("/api/auth/register", { data: { name: "B", email: `bot${Date.now()}@example.com`, password: "password123", acceptTerms: true, website: "http://spam" } });
  expect(bot.ok()).toBeTruthy();
  expect((await page.request.get("/api/auth/me").then((r) => r.json())).user).toBeNull();
});

test("sessions are revocable: log out everywhere, password change, and disabling", async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  const { email, password } = await registerUser(pa, "sess");
  await loginAs(pb, email, password);
  expect((await pb.request.get("/api/account")).ok()).toBeTruthy();

  // "sair de todos os dispositivos" from A kills B's cookie too.
  expect((await pa.request.post("/api/auth/logout", { data: { everywhere: true } })).ok()).toBeTruthy();
  expect((await pb.request.get("/api/account")).status()).toBe(401);

  // A password change keeps the current device and drops the others.
  await loginAs(pa, email, password);
  await loginAs(pb, email, password);
  const change = await pa.request.post("/api/account/password", { data: { current: password, next: "newpassword456" } });
  expect(change.ok()).toBeTruthy();
  expect((await pa.request.get("/api/account")).ok()).toBeTruthy();
  expect((await pb.request.get("/api/account")).status()).toBe(401);
  expect((await pb.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(401);

  // The admin disables the account: the session dies and login is refused.
  const admin = await (await browser.newContext()).newPage();
  await loginAdmin(admin);
  const found = await admin.request.get(`/api/admin/users?q=${encodeURIComponent(email)}`).then((r) => r.json());
  const userId = found.users[0].id;
  expect((await admin.request.post("/api/admin/users", { data: { action: "disable", userId, disabled: true } })).ok()).toBeTruthy();
  expect((await pa.request.get("/api/account")).status()).toBe(401);
  const refused = await pa.request.post("/api/auth/login", { data: { email, password: "newpassword456" } });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).error).toBe("account_disabled");

  // Re-enabled, then a one-time password from support: it works once and asks for a new one.
  await admin.request.post("/api/admin/users", { data: { action: "disable", userId, disabled: false } });
  const reset = await admin.request.post("/api/admin/users", { data: { action: "reset_password", userId } }).then((r) => r.json());
  expect(reset.oneTimePassword).toMatch(/^[A-Za-z2-9]{14}$/);
  const login = await loginAs(pa, email, reset.oneTimePassword);
  expect(login.mustChangePassword).toBe(true);
  await Promise.all([a.close(), b.close()]);
});
