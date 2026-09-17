import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-account");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });

const auth = await import("@/lib/server/auth");
const users = await import("@/lib/server/users");
const { exportAccount, deleteAccount } = await import("@/lib/server/account-data");
const { getDb, DELETED_USER_ID, addColumn } = await import("@/lib/server/db");
const rl = await import("@/lib/server/rate-limit");
const budget = await import("@/lib/server/ai-budget");
const { safeNextPath, configuredBaseUrl, requireBaseUrl } = await import("@/lib/base-url");

describe("passwords and sessions", () => {
  it("hashes asynchronously and verifies in constant time", async () => {
    const hash = await auth.hashPassword("correct horse");
    expect(await auth.verifyPassword("correct horse", hash)).toBe(true);
    expect(await auth.verifyPassword("wrong", hash)).toBe(false);
    expect(await auth.verifyPassword("x", "garbage")).toBe(false);
  });

  it("rejects tampered tokens and carries the session version", () => {
    const token = auth.signSession({ userId: "usr_1", role: "user", sv: 3 });
    expect(auth.verifySession(token)?.sv).toBe(3);
    const [body, sig] = token.split(".");
    expect(auth.verifySession(`${body}.${sig.slice(0, -1)}A`)).toBeNull();
    const forged = Buffer.from(JSON.stringify({ userId: "usr_1", role: "admin", sv: 3, exp: Date.now() + 1e6 })).toString("base64url");
    expect(auth.verifySession(`${forged}.${sig}`)).toBeNull();
  });

  it("refuses to sign without a real secret (no public fallback)", () => {
    const saved = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "short";
    expect(() => auth.signSession({ userId: "u", role: "user", sv: 0 })).toThrow(/AUTH_SECRET/);
    process.env.AUTH_SECRET = saved;
  });

  it("safeEqual compares without leaking length", () => {
    expect(auth.safeEqual("abc", "abc")).toBe(true);
    expect(auth.safeEqual("abc", "abcd")).toBe(false);
    expect(auth.safeEqual("", "")).toBe(false);
    expect(auth.safeEqual(null, "a")).toBe(false);
  });

  it("password change, admin reset and disable all bump the session version", async () => {
    const u = await users.createUser({ email: "Sess@X.com ", name: "S", password: "password123", acceptedTerms: true });
    expect(u.email).toBe("sess@x.com");
    expect(u.termsAcceptedAt).not.toBeNull();
    expect(u.termsVersion).toBe(users.TERMS_VERSION);
    await expect(users.createUser({ email: "sess@x.com", name: "S", password: "password123" })).rejects.toBeInstanceOf(users.EmailTakenError);

    expect(await users.changePassword(u.id, "nope", "newpassword1")).toBe("wrong_password");
    expect(await users.changePassword(u.id, "password123", "newpassword1")).toBe("ok");
    expect(users.findById(u.id)!.sessionVersion).toBe(1);
    expect((await users.authenticate("sess@x.com", "newpassword1")).ok).toBe(true);

    const otp = await users.resetPasswordByAdmin(u.id);
    expect(otp).toMatch(/^[A-Za-z2-9]{14}$/);
    const row = users.findById(u.id)!;
    expect(row.sessionVersion).toBe(2);
    expect(row.mustChangePassword).toBe(1);
    expect((await users.authenticate("sess@x.com", otp!)).ok).toBe(true);

    expect(users.setDisabled(u.id, true)).toBe(true);
    const disabled = await users.authenticate("sess@x.com", otp!);
    expect(disabled).toEqual({ ok: false, reason: "disabled" });
    expect(users.findById(u.id)!.sessionVersion).toBe(3);
    users.setDisabled(u.id, false);
    expect((await users.authenticate("unknown@x.com", "whatever")).ok).toBe(false);
  });
});

describe("LGPD export and erasure", () => {
  it("exports without the password hash and erases while keeping payments anonymised", async () => {
    const u = await users.createUser({ email: "gone@x.com", name: "Gone", password: "password123" });
    users.adjustCoins(u.id, 10, "test");
    getDb().prepare("INSERT INTO payments (id,userId,kind,reference,amount,status,createdAt) VALUES ('pay_keep',?,'coins','pack_50',19,'approved',?)").run(u.id, new Date().toISOString());
    getDb().prepare("INSERT INTO contact_messages (id,userId,email,message,createdAt,updatedAt) VALUES ('c1',?,?,?,?,?)").run(u.id, u.email, "oi", "t", "t");
    const data = exportAccount(u.id)!;
    expect(JSON.stringify(data)).not.toContain(u.passwordHash);
    expect((data.coinLedger as unknown[]).length).toBe(1);
    expect((data.payments as unknown[]).length).toBe(1);

    expect(deleteAccount(u.id)).toBe(true);
    expect(users.findById(u.id)).toBeUndefined();
    const pay = getDb().prepare("SELECT userId, formerUserRef FROM payments WHERE id = 'pay_keep'").get() as { userId: string; formerUserRef: string };
    expect(pay.userId).toBe(DELETED_USER_ID);
    expect(pay.formerUserRef).toBe(users.formerUserRef(u.id));
    expect(getDb().prepare("SELECT COUNT(*) n FROM coin_ledger WHERE userId = ?").get(u.id)).toEqual({ n: 0 });
    expect(getDb().prepare("SELECT COUNT(*) n FROM contact_messages WHERE userId = ?").get(u.id)).toEqual({ n: 0 });
    expect(users.countUsers()).toBeGreaterThan(0);
    expect(users.listUsers().some((r) => r.id === DELETED_USER_ID)).toBe(false);
    expect((await users.authenticate("deleted-accounts@betmatic.invalid", "!")).ok).toBe(false);
  });

  it("column migrations are idempotent", () => {
    addColumn(getDb(), "users", "sessionVersion", "INTEGER NOT NULL DEFAULT 0");
    addColumn(getDb(), "users", "sessionVersion", "INTEGER NOT NULL DEFAULT 0");
    addColumn(getDb(), "no_such_table", "x", "TEXT");
  });
});

describe("rate limits", () => {
  it("blocks after the budget and reports when to retry", () => {
    rl.resetRateLimits();
    const t0 = 1_000_000;
    for (let i = 0; i < rl.RULES.signupIp.max; i++) expect(rl.hit("signupIp", "ip:1.2.3.4", t0).ok).toBe(true);
    const blocked = rl.hit("signupIp", "ip:1.2.3.4", t0 + 1000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(rl.hit("signupIp", "ip:5.6.7.8", t0).ok).toBe(true);
    expect(rl.hit("signupIp", "ip:1.2.3.4", t0 + rl.RULES.signupIp.windowMs + 1).ok).toBe(true);
  });

  it("peek does not count; record does", () => {
    rl.resetRateLimits();
    for (let i = 0; i < 20; i++) expect(rl.peek("loginAccount", "acct:a").ok).toBe(true);
    for (let i = 0; i < rl.RULES.loginAccount.max; i++) rl.record("loginAccount", "acct:a");
    expect(rl.peek("loginAccount", "acct:a").ok).toBe(false);
  });

  it("reads the first X-Forwarded-For entry", () => {
    const req = new Request("http://x/", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } });
    expect(rl.clientIp(req)).toBe("203.0.113.9");
    expect(rl.clientIp(new Request("http://x/"))).toBe("local");
  });
});

describe("AI spend ceiling", () => {
  it("sums recorded cost for the Brasília day and trips at the budget", () => {
    process.env.AI_DAILY_BUDGET_USD = "1";
    budget.recordAiSpend({ label: "t", model: "m", inputTokens: 1, outputTokens: 1, costUsd: 0.6 });
    expect(() => budget.assertAiBudget()).not.toThrow();
    budget.recordAiSpend({ label: "t", model: "m", inputTokens: 1, outputTokens: 1, costUsd: 0.5 });
    expect(() => budget.assertAiBudget()).toThrow(budget.AiBudgetExceededError);
    process.env.AI_DAILY_BUDGET_USD = "0";
    expect(budget.budgetState().exhausted).toBe(true);
    delete process.env.AI_DAILY_BUDGET_USD;
    expect(budget.aiDailyBudgetUsd({})).toBe(budget.DEFAULT_DAILY_BUDGET_USD);
    expect(budget.aiDailyBudgetUsd({ AI_DAILY_BUDGET_USD: "abc" })).toBe(budget.DEFAULT_DAILY_BUDGET_USD);
  });

  it("the day starts at midnight in São Paulo", () => {
    expect(budget.brasiliaDayStart(new Date("2026-09-17T02:00:00Z"))).toBe("2026-09-16T03:00:00.000Z");
    expect(budget.brasiliaDayStart(new Date("2026-09-17T04:00:00Z"))).toBe("2026-09-17T03:00:00.000Z");
  });
});

describe("base URL and redirects", () => {
  it("never falls back to localhost for absolute links", () => {
    const saved = { a: process.env.APP_URL, b: process.env.NEXT_PUBLIC_BASE_URL };
    delete process.env.APP_URL;
    process.env.NEXT_PUBLIC_BASE_URL = "https://betmatic.example/";
    expect(configuredBaseUrl()).toBe("https://betmatic.example");
    delete process.env.NEXT_PUBLIC_BASE_URL;
    expect(() => requireBaseUrl()).toThrow();
    process.env.APP_URL = saved.a;
    process.env.NEXT_PUBLIC_BASE_URL = saved.b;
  });

  it("only accepts same-origin return paths", () => {
    expect(safeNextPath("/app?sport=wnba")).toBe("/app?sport=wnba");
    expect(safeNextPath("//evil.com")).toBeNull();
    expect(safeNextPath("/\\evil.com")).toBeNull();
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });
});
