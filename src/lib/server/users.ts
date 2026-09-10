import { getDb, newId, nowIso } from "@/lib/server/db";
import { hashPassword, verifyPassword } from "@/lib/server/auth";
import { getPlan, PERIOD, type BillingPeriod, type Plan, type Role } from "@/lib/plans";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  planId: string;
  planPeriod: BillingPeriod;
  planExpiresAt: string | null;
  coins: number;
  lang: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export type PublicUser = Omit<UserRow, "passwordHash"> & { plan: Plan; planActive: boolean };

export function toPublic(row: UserRow): PublicUser {
  const active = planIsActive(row);
  return {
    ...{ ...row, passwordHash: undefined } as unknown as Omit<UserRow, "passwordHash">,
    // An expired subscription falls back to free rather than silently keeping paid access.
    plan: active ? getPlan(row.planId) : getPlan("free"),
    planActive: active,
  };
}

export function planIsActive(row: UserRow): boolean {
  if (row.planId === "free") return true;
  if (!row.planExpiresAt) return false;
  return row.planExpiresAt > nowIso();
}

export function findByEmail(email: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as UserRow | undefined;
}

export function findById(id: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function countUsers(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

export function createUser(input: {
  email: string;
  name: string;
  password: string;
  lang?: string;
  role?: Role;
}): UserRow {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  if (findByEmail(email)) throw new Error("E-mail já cadastrado");

  // The very first account becomes the admin; there is no other way to bootstrap one.
  const role: Role = input.role ?? (countUsers() === 0 ? "admin" : "user");
  const row: UserRow = {
    id: newId("usr"),
    email,
    name: input.name.trim() || email.split("@")[0],
    passwordHash: hashPassword(input.password),
    role,
    planId: role === "admin" ? "max" : "free",
    planPeriod: "monthly",
    // Admins are not billed; a far-future expiry keeps the same code path working for them.
    planExpiresAt: role === "admin" ? "2999-01-01T00:00:00.000Z" : null,
    coins: role === "admin" ? 100_000 : 0,
    lang: input.lang ?? "pt",
    createdAt: nowIso(),
    lastSeenAt: nowIso(),
  };
  db.prepare(
    `INSERT INTO users (id,email,name,passwordHash,role,planId,planPeriod,planExpiresAt,coins,lang,createdAt,lastSeenAt)
     VALUES (@id,@email,@name,@passwordHash,@role,@planId,@planPeriod,@planExpiresAt,@coins,@lang,@createdAt,@lastSeenAt)`,
  ).run(row);
  return row;
}

export function authenticate(email: string, password: string): UserRow | null {
  const row = findByEmail(email);
  if (!row || !verifyPassword(password, row.passwordHash)) return null;
  getDb().prepare("UPDATE users SET lastSeenAt = ? WHERE id = ?").run(nowIso(), row.id);
  return row;
}

export class InsufficientCoinsError extends Error {
  constructor(public needed: number, public balance: number) {
    super(`Precisa de ${needed} coins e você tem ${balance}.`);
    this.name = "InsufficientCoinsError";
  }
}

/**
 * Credits or debits coins inside one transaction so the balance and its ledger entry can never
 * disagree, and a debit can never take the balance below zero.
 */
export function adjustCoins(
  userId: string,
  delta: number,
  reason: string,
  meta: Record<string, unknown> = {},
): number {
  const db = getDb();
  const run = db.transaction(() => {
    const user = db.prepare("SELECT coins FROM users WHERE id = ?").get(userId) as { coins: number } | undefined;
    if (!user) throw new Error("Usuário não encontrado");
    const next = user.coins + delta;
    if (next < 0) throw new InsufficientCoinsError(-delta, user.coins);
    db.prepare("UPDATE users SET coins = ? WHERE id = ?").run(next, userId);
    db.prepare(
      `INSERT INTO coin_ledger (id,userId,delta,reason,balanceAfter,meta,createdAt)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(newId("cl"), userId, delta, reason, next, JSON.stringify(meta), nowIso());
    return next;
  });
  return run();
}

export function activatePlan(userId: string, planId: string, period: BillingPeriod): void {
  const db = getDb();
  const plan = getPlan(planId);
  const months = PERIOD[period].months;
  const current = findById(userId);
  // Renewing early extends from the existing expiry rather than truncating paid time.
  const base =
    current?.planExpiresAt && current.planExpiresAt > nowIso() && current.planId === planId
      ? new Date(current.planExpiresAt)
      : new Date();
  base.setMonth(base.getMonth() + months);

  db.prepare("UPDATE users SET planId = ?, planPeriod = ?, planExpiresAt = ? WHERE id = ?").run(
    planId,
    period,
    base.toISOString(),
    userId,
  );
  if (plan.coinsPerPeriod > 0) {
    adjustCoins(userId, plan.coinsPerPeriod, `plan:${planId}:${period}`);
  }
}

export function listUsers(limit = 200): UserRow[] {
  return getDb().prepare("SELECT * FROM users ORDER BY createdAt DESC LIMIT ?").all(limit) as UserRow[];
}

export function coinHistory(userId: string, limit = 50) {
  return getDb()
    .prepare("SELECT * FROM coin_ledger WHERE userId = ? ORDER BY createdAt DESC LIMIT ?")
    .all(userId, limit);
}
