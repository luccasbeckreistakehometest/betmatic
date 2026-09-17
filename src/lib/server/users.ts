import { createHash, randomBytes } from "node:crypto";
import { DELETED_USER_ID, getDb, newId, nowIso } from "@/lib/server/db";
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
  sessionVersion: number;
  disabledAt: string | null;
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  mustChangePassword: number;
}

export type PublicUser = Omit<UserRow, "passwordHash"> & { plan: Plan; planActive: boolean };

/** Bumped when the terms or the privacy notice change in a way that needs fresh consent. */
export const TERMS_VERSION = "2026-09-17";

export function toPublic(row: UserRow): PublicUser {
  const active = planIsActive(row);
  const { passwordHash: _hash, ...rest } = row;
  void _hash;
  return {
    ...rest,
    // An expired plan falls back to free rather than silently keeping paid access.
    plan: active ? getPlan(row.planId) : getPlan("free"),
    planActive: active,
  };
}

export function planIsActive(row: Pick<UserRow, "planId" | "planExpiresAt">): boolean {
  if (row.planId === "free") return true;
  if (!row.planExpiresAt) return false;
  return row.planExpiresAt > nowIso();
}

export function findByEmail(email: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as UserRow | undefined;
}

export function findById(id: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function countUsers(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE id != ?").get(DELETED_USER_ID) as { n: number }).n;
}

export class EmailTakenError extends Error {
  constructor() {
    super("email_taken");
    this.name = "EmailTakenError";
  }
}

/**
 * New accounts are always plain users. The admin comes only from ADMIN_EMAIL/ADMIN_PASSWORD
 * (db.ts): a "first signup becomes admin" rule would hand the panel to a stranger the day the data
 * volume is lost.
 */
export async function createUser(input: {
  email: string;
  name: string;
  password: string;
  lang?: string;
  acceptedTerms?: boolean;
}): Promise<UserRow> {
  const email = input.email.trim().toLowerCase();
  if (findByEmail(email)) throw new EmailTakenError();
  const now = nowIso();
  const row: UserRow = {
    id: newId("usr"),
    email,
    name: input.name.trim() || email.split("@")[0],
    passwordHash: await hashPassword(input.password),
    role: "user",
    planId: "free",
    planPeriod: "monthly",
    planExpiresAt: null,
    coins: 0,
    lang: input.lang ?? "pt",
    createdAt: now,
    lastSeenAt: now,
    sessionVersion: 0,
    disabledAt: null,
    termsAcceptedAt: input.acceptedTerms ? now : null,
    termsVersion: input.acceptedTerms ? TERMS_VERSION : null,
    mustChangePassword: 0,
  };
  try {
    getDb().prepare(
      `INSERT INTO users (id,email,name,passwordHash,role,planId,planPeriod,planExpiresAt,coins,lang,createdAt,lastSeenAt,sessionVersion,disabledAt,termsAcceptedAt,termsVersion,mustChangePassword)
       VALUES (@id,@email,@name,@passwordHash,@role,@planId,@planPeriod,@planExpiresAt,@coins,@lang,@createdAt,@lastSeenAt,@sessionVersion,@disabledAt,@termsAcceptedAt,@termsVersion,@mustChangePassword)`,
    ).run(row);
  } catch (error) {
    // Two signups for the same address racing past the lookup above.
    if (error instanceof Error && /UNIQUE/i.test(error.message)) throw new EmailTakenError();
    throw error;
  }
  return row;
}

export type AuthResult = { ok: true; user: UserRow } | { ok: false; reason: "invalid" | "disabled" };

export async function authenticate(email: string, password: string): Promise<AuthResult> {
  const row = findByEmail(email);
  if (!row || row.id === DELETED_USER_ID) {
    // Spend the same scrypt time on unknown addresses so timing does not reveal which ones exist.
    await verifyPassword(password, `${"0".repeat(32)}:${"0".repeat(64)}`);
    return { ok: false, reason: "invalid" };
  }
  if (!(await verifyPassword(password, row.passwordHash))) return { ok: false, reason: "invalid" };
  if (row.disabledAt) return { ok: false, reason: "disabled" };
  getDb().prepare("UPDATE users SET lastSeenAt = ? WHERE id = ?").run(nowIso(), row.id);
  return { ok: true, user: row };
}

/** Revokes every session of the user: tokens carry the version they were issued under. */
export function bumpSessionVersion(userId: string): number {
  getDb().prepare("UPDATE users SET sessionVersion = sessionVersion + 1 WHERE id = ?").run(userId);
  return findById(userId)?.sessionVersion ?? 0;
}

export function verifyUserPassword(row: Pick<UserRow, "passwordHash">, password: string): Promise<boolean> {
  return verifyPassword(password, row.passwordHash);
}

export async function changePassword(userId: string, current: string, next: string): Promise<"ok" | "wrong_password" | "not_found"> {
  const row = findById(userId);
  if (!row) return "not_found";
  if (!(await verifyPassword(current, row.passwordHash))) return "wrong_password";
  await setPassword(userId, next);
  return "ok";
}

/** Sets a password and logs every device out. */
export async function setPassword(userId: string, password: string, opts: { mustChange?: boolean } = {}): Promise<void> {
  const hash = await hashPassword(password);
  getDb().prepare("UPDATE users SET passwordHash = ?, mustChangePassword = ?, sessionVersion = sessionVersion + 1 WHERE id = ?")
    .run(hash, opts.mustChange ? 1 : 0, userId);
}

/** A one-time password the admin reads once and hands over; the user is asked to change it. */
export async function resetPasswordByAdmin(userId: string): Promise<string | null> {
  if (!findById(userId)) return null;
  // No ambiguous characters: this is read out loud or typed from a message.
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(14);
  const otp = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  await setPassword(userId, otp, { mustChange: true });
  return otp;
}

export function setDisabled(userId: string, disabled: boolean): boolean {
  const res = getDb().prepare("UPDATE users SET disabledAt = ?, sessionVersion = sessionVersion + 1 WHERE id = ? AND id != ?")
    .run(disabled ? nowIso() : null, userId, DELETED_USER_ID);
  return res.changes > 0;
}

export class InsufficientCoinsError extends Error {
  constructor(public needed: number, public balance: number) {
    super(`insufficient_coins`);
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
    if (!user) throw new Error("user_not_found");
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

/**
 * The new expiry after a purchase. Same plan: the period is added to what is left. Different plan
 * while one is active: the days left are converted at the ratio of the monthly prices, then the
 * period is added from now — nobody loses paid time by upgrading or downgrading.
 */
export function nextPlanExpiry(current: Pick<UserRow, "planId" | "planExpiresAt"> | undefined, planId: string, period: BillingPeriod, now = new Date()): Date {
  const months = (PERIOD[period] ?? PERIOD.monthly).months;
  const active = !!current?.planExpiresAt && current.planExpiresAt > now.toISOString() && current.planId !== "free";
  let base = new Date(now);
  if (active && current!.planId === planId) {
    base = new Date(current!.planExpiresAt!);
  } else if (active) {
    const oldPrice = getPlan(current!.planId).monthlyPrice;
    const newPrice = getPlan(planId).monthlyPrice;
    const leftMs = Date.parse(current!.planExpiresAt!) - now.getTime();
    if (oldPrice > 0 && newPrice > 0 && leftMs > 0) base = new Date(now.getTime() + Math.round(leftMs * (oldPrice / newPrice)));
  }
  base.setMonth(base.getMonth() + months);
  return base;
}

/** An account's plan at one moment; payments keep the state before and after each plan purchase. */
export interface PlanState { planId: string; planPeriod: BillingPeriod; planExpiresAt: string | null }

export const planStateOf = (row: Pick<UserRow, "planId" | "planPeriod" | "planExpiresAt">): PlanState =>
  ({ planId: row.planId, planPeriod: row.planPeriod, planExpiresAt: row.planExpiresAt ?? null });

export function activatePlan(userId: string, planId: string, period: BillingPeriod, meta: Record<string, unknown> = {}, now = new Date()): { before: PlanState; after: PlanState } {
  const db = getDb();
  const plan = getPlan(planId);
  const current = findById(userId);
  if (!current) throw new Error("user_not_found");
  const before = planStateOf(current);
  const after: PlanState = { planId: plan.id, planPeriod: period, planExpiresAt: nextPlanExpiry(current, plan.id, period, now).toISOString() };
  db.prepare("UPDATE users SET planId = ?, planPeriod = ?, planExpiresAt = ? WHERE id = ?").run(after.planId, after.planPeriod, after.planExpiresAt, userId);
  if (plan.coinsPerPeriod > 0) {
    adjustCoins(userId, plan.coinsPerPeriod, `plan:${planId}:${period}`, meta);
  }
  return { before, after };
}

/** Admin override: any plan with an explicit expiry (null expiry = free). */
export function setPlanByAdmin(userId: string, planId: string, expiresAt: string | null, period: BillingPeriod = "monthly"): boolean {
  const plan = getPlan(planId);
  const res = getDb().prepare("UPDATE users SET planId = ?, planPeriod = ?, planExpiresAt = ? WHERE id = ?")
    .run(plan.id, period, plan.id === "free" ? null : expiresAt, userId);
  return res.changes > 0;
}

export function listUsers(opts: { limit?: number; search?: string } = {}): UserRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const q = (opts.search ?? "").trim().toLowerCase();
  if (q) {
    return getDb().prepare("SELECT * FROM users WHERE id != ? AND (email LIKE ? OR lower(name) LIKE ? OR id = ?) ORDER BY createdAt DESC LIMIT ?")
      .all(DELETED_USER_ID, `%${q}%`, `%${q}%`, q, limit) as UserRow[];
  }
  return getDb().prepare("SELECT * FROM users WHERE id != ? ORDER BY createdAt DESC LIMIT ?").all(DELETED_USER_ID, limit) as UserRow[];
}

export interface CoinLedgerRow { id: string; delta: number; reason: string; balanceAfter: number; createdAt: string }

export function coinHistory(userId: string, limit = 50): CoinLedgerRow[] {
  return getDb()
    .prepare("SELECT id, delta, reason, balanceAfter, createdAt FROM coin_ledger WHERE userId = ? ORDER BY createdAt DESC, rowid DESC LIMIT ?")
    .all(userId, limit) as CoinLedgerRow[];
}

/** A stable, non-reversible tag that lets accounting group an erased user's payments. */
export const formerUserRef = (userId: string) => createHash("sha256").update(`former:${userId}`).digest("hex").slice(0, 16);
