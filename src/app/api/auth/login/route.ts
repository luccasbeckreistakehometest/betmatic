import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/server/users";
import { issueSession } from "@/lib/server/session";
import { apiError, rateLimited, requestLang } from "@/lib/server/api";
import { accountKey, ipKey, peek, record } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().max(254),
  password: z.string().max(200),
  lang: z.enum(["pt", "en"]).optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  const lang = requestLang(request, parsed.success ? parsed.data.lang : null);
  if (!parsed.success) return apiError("invalid_input", lang, 400);

  // Only failures count, per address and per account, so a user who types right is never slowed.
  const ip = ipKey(request);
  const acct = accountKey(parsed.data.email);
  const ipState = peek("loginIp", ip);
  if (!ipState.ok) return rateLimited(ipState, lang);
  const acctState = peek("loginAccount", acct);
  if (!acctState.ok) return rateLimited(acctState, lang);

  const result = await authenticate(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    record("loginIp", ip);
    record("loginAccount", acct);
    // One message for unknown e-mail and wrong password so the response cannot enumerate accounts.
    return result.reason === "disabled" ? apiError("account_disabled", lang, 403) : apiError("invalid_credentials", lang, 401);
  }
  await issueSession(result.user);
  return NextResponse.json({ ok: true, role: result.user.role, mustChangePassword: !!result.user.mustChangePassword });
}
