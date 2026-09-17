import { NextResponse } from "next/server";
import { clearSession, currentUser } from "@/lib/server/session";
import { bumpSessionVersion } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `{ everywhere: true }` revokes every session of the account (all devices), not just this cookie. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { everywhere?: boolean };
  if (body?.everywhere) {
    const user = await currentUser({ pendingPasswordChange: true });
    if (user) bumpSessionVersion(user.id);
  }
  await clearSession();
  return NextResponse.json({ ok: true });
}
