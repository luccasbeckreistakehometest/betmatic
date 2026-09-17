import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createUser, EmailTakenError } from "@/lib/server/users";
import { REF_COOKIE, recordReferral } from "@/lib/server/referral";
import { issueSession } from "@/lib/server/session";
import { apiError, rateLimited, requestLang } from "@/lib/server/api";
import { hit, ipKey } from "@/lib/server/rate-limit";
import { reportError } from "@/lib/server/ops-log";
import { anonIdFromCookies, firstTouchFromCookies, recordEvent } from "@/lib/server/analytics";
import { getDb } from "@/lib/server/db";
import { sourceOf } from "@/lib/analytics/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().max(254).email(),
  password: z.string().max(200),
  lang: z.enum(["pt", "en"]).default("pt"),
  // Explicit consent: 18+ and the terms/privacy notice. Stored with a timestamp and the version.
  acceptTerms: z.literal(true).optional(),
  // Honeypot: real people never see this field.
  website: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  const lang = requestLang(request, parsed.success ? parsed.data.lang : null);
  if (!parsed.success) return apiError("invalid_input", lang, 400);
  const data = parsed.data;
  if (data.password.length < 8) return apiError("weak_password", lang, 400);
  if (data.acceptTerms !== true) return apiError("terms_required", lang, 400);

  const limit = hit("signupIp", ipKey(request));
  if (!limit.ok) return rateLimited(limit, lang);
  // A bot that filled the hidden field gets a success-shaped answer and no account.
  if (data.website) return NextResponse.json({ ok: true, role: "user" });

  try {
    const user = await createUser({ name: data.name, email: data.email, password: data.password, lang: data.lang, acceptedTerms: true });
    const jar = await cookies();
    // The referral is remembered now and paid on the first purchase; the cookie is spent either way.
    recordReferral(user.id, jar.get(REF_COOKIE)?.value);
    if (jar.get(REF_COOKIE)) jar.set(REF_COOKIE, "", { path: "/", maxAge: 0 });
    // First touch: which campaign or site brought this person (no IP, no third party).
    const ft = await firstTouchFromCookies();
    const source = ft ? sourceOf({ utmSource: ft.s, refHost: ft.r }) : "direto";
    getDb().prepare("UPDATE users SET signupSource = ?, signupUtm = ? WHERE id = ?").run(source, ft ? JSON.stringify(ft) : null, user.id);
    recordEvent("signup_done", user.id, { source, campaign: ft?.c ?? "", landing: ft?.l ?? "" }, { anonId: await anonIdFromCookies() });
    await issueSession(user);
    return NextResponse.json({ ok: true, role: user.role });
  } catch (error) {
    if (error instanceof EmailTakenError) return apiError("email_taken", lang, 409);
    reportError("auth.register", error);
    return apiError("server_error", lang, 500);
  }
}
