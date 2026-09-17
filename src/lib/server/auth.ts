import { createHash, createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { validSecret } from "@/lib/env";

export const SESSION_COOKIE = "betmatic_session";
export const SESSION_DAYS = 30;
const KEY_LENGTH = 32;

function secret(): string {
  const value = (process.env.AUTH_SECRET ?? "").trim();
  if (!validSecret(value)) {
    // Failing loudly beats signing sessions with a guessable default. There is no fallback on purpose.
    throw new Error("AUTH_SECRET is missing or too short — set a long random value (openssl rand -hex 32).");
  }
  return value;
}

/** True when the process can sign sessions; production startup refuses to run without it. */
export function authSecretConfigured(): boolean {
  return validSecret(process.env.AUTH_SECRET);
}

function scryptAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** Async so a burst of logins never blocks the event loop the whole app shares. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await scryptAsync(password, salt)).toString("hex")}`;
}

/** Only for the one-off admin seed that runs while the database opens (never on a request path). */
export function hashPasswordSync(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, KEY_LENGTH).toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const candidate = await scryptAsync(password, salt);
  // Constant-time compare so a wrong password cannot be narrowed by timing.
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

/**
 * Constant-time string equality. Both sides are hashed first so the comparison never leaks the
 * length of the secret either.
 */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export interface SessionPayload {
  userId: string;
  role: "user" | "admin";
  /** The user's session version when the token was issued; bumping it revokes every older token. */
  sv: number;
  exp: number;
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function signSession(payload: Omit<SessionPayload, "exp">): string {
  const full: SessionPayload = { ...payload, exp: Date.now() + SESSION_DAYS * 86_400_000 };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifySession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  if (!safeEqual(signature, sign(body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (typeof payload.sv !== "number") payload.sv = 0;
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  };
}
