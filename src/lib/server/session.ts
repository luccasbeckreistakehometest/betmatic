import { cookies } from "next/headers";
import { SESSION_COOKIE, sessionCookieOptions, signSession, verifySession, type SessionPayload } from "@/lib/server/auth";
import { findById, toPublic, type PublicUser, type UserRow } from "@/lib/server/users";

export async function getSession(): Promise<SessionPayload | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * The signed cookie alone is not enough: the token's session version must match the user's current
 * one (bumped on password change, disable and "log out everywhere") and the account must be active.
 * An account signed in with an admin-issued one-time password counts as signed out everywhere except
 * the few routes that let it set a new password (`pendingPasswordChange: true`): whoever read the
 * one-time password cannot keep using the account through it.
 */
export async function currentUser(opts: { pendingPasswordChange?: boolean } = {}): Promise<PublicUser | null> {
  const session = await getSession();
  if (!session) return null;
  const row = findById(session.userId);
  if (!row || row.disabledAt || (row.sessionVersion ?? 0) !== session.sv) return null;
  if (row.mustChangePassword && !opts.pendingPasswordChange) return null;
  return toPublic(row);
}

/** Role used for whitelabel scrubbing. Anonymous visitors get the most restricted view. */
export async function currentRole(): Promise<"user" | "admin"> {
  const user = await currentUser();
  return user?.role === "admin" ? "admin" : "user";
}

export async function requireAdmin(): Promise<PublicUser | null> {
  const user = await currentUser();
  return user?.role === "admin" ? user : null;
}

/** Sets the session cookie for a user at their current session version. */
export async function issueSession(row: Pick<UserRow, "id" | "role" | "sessionVersion">): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, signSession({ userId: row.id, role: row.role, sv: row.sessionVersion ?? 0 }), sessionCookieOptions());
}

export async function clearSession(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
}
