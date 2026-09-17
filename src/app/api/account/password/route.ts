import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, issueSession } from "@/lib/server/session";
import { changePassword, findById } from "@/lib/server/users";
import { apiError, rateLimited, requestLang } from "@/lib/server/api";
import { accountKey, hit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ current: z.string().max(200), next: z.string().max(200) });

/** Changing the password logs every other device out; this one gets a fresh cookie. */
export async function POST(request: Request) {
  const user = await currentUser();
  const lang = requestLang(request, user?.lang);
  if (!user) return apiError("unauthenticated", lang, 401);
  const limit = hit("passwordAccount", accountKey(user.id));
  if (!limit.ok) return rateLimited(limit, lang);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("invalid_input", lang, 400);
  if (parsed.data.next.length < 8) return apiError("weak_password", lang, 400);
  const result = await changePassword(user.id, parsed.data.current, parsed.data.next);
  if (result === "wrong_password") return apiError("wrong_password", lang, 400);
  if (result === "not_found") return apiError("unauthenticated", lang, 401);
  const fresh = findById(user.id);
  if (fresh) await issueSession(fresh);
  return NextResponse.json({ ok: true });
}
