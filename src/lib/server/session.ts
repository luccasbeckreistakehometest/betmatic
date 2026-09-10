import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "@/lib/server/auth";
import { findById, toPublic, type PublicUser } from "@/lib/server/users";

export async function getSession(): Promise<SessionPayload | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function currentUser(): Promise<PublicUser | null> {
  const session = await getSession();
  if (!session) return null;
  const row = findById(session.userId);
  return row ? toPublic(row) : null;
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
