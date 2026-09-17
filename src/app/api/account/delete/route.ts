import { NextResponse } from "next/server";
import { z } from "zod";
import { clearSession, currentUser } from "@/lib/server/session";
import { deleteAccount } from "@/lib/server/account-data";
import { findById, verifyUserPassword } from "@/lib/server/users";
import { apiError, rateLimited, requestLang } from "@/lib/server/api";
import { accountKey, hit } from "@/lib/server/rate-limit";
import { logEvent } from "@/lib/server/ops-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ password: z.string().max(200), confirm: z.literal(true) });

/**
 * LGPD erasure. Needs the password and an explicit confirmation. Payment rows are kept anonymised
 * (tax and accounting duties); everything else tied to the account is deleted.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  const lang = requestLang(request, user?.lang);
  if (!user) return apiError("unauthenticated", lang, 401);
  const limit = hit("accountDangerAccount", accountKey(user.id));
  if (!limit.ok) return rateLimited(limit, lang);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("invalid_input", lang, 400);
  if (user.role === "admin") return apiError("forbidden", lang, 403);
  const row = findById(user.id);
  if (!row || !(await verifyUserPassword(row, parsed.data.password))) return apiError("wrong_password", lang, 400);
  deleteAccount(user.id);
  await clearSession();
  logEvent("account.deleted", { at: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
