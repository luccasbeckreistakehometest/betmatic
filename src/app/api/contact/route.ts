import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { CONTACT_TOPICS, createContactMessage } from "@/lib/server/contact";
import { apiError, rateLimited, requestLang } from "@/lib/server/api";
import { accountKey, hit, ipKey } from "@/lib/server/rate-limit";
import { logEvent } from "@/lib/server/ops-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().max(80).default(""),
  email: z.string().trim().max(254).email(),
  topic: z.enum(CONTACT_TOPICS).default("other"),
  message: z.string().trim().min(10).max(4000),
  lang: z.enum(["pt", "en"]).optional(),
  website: z.string().max(200).optional(),
});

/** The in-app contact form. Stored for the admin inbox; rate limited; a honeypot drops bots. */
export async function POST(request: Request) {
  const user = await currentUser();
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  const lang = requestLang(request, parsed.success ? parsed.data.lang : user?.lang);
  if (!parsed.success) return apiError("invalid_input", lang, 400);
  const limit = hit("contactIp", ipKey(request));
  if (!limit.ok) return rateLimited(limit, lang);
  if (user) {
    const acct = hit("contactIp", accountKey(user.id));
    if (!acct.ok) return rateLimited(acct, lang);
  }
  if (parsed.data.website) return NextResponse.json({ ok: true });
  const id = createContactMessage({ userId: user?.id ?? null, name: parsed.data.name, email: parsed.data.email, topic: parsed.data.topic, message: parsed.data.message, lang });
  logEvent("contact.received", { id, topic: parsed.data.topic });
  return NextResponse.json({ ok: true });
}
