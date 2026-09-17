import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb, nowIso } from "@/lib/server/db";
import { currentUser } from "@/lib/server/session";
import { hit, ipKey } from "@/lib/server/rate-limit";
import { ANON_COOKIE, deviceOf, FIRST_TOUCH_COOKIE, isBot, isClientEvent, refHostOf, utmFrom } from "@/lib/analytics/events";
import { publicBaseUrl } from "@/lib/base-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const YEAR = 365 * 86_400;
const FIRST_TOUCH_AGE = 90 * 86_400;

/**
 * The browser's analytics beacon. Allowlisted names only, bots and prefetches dropped, no IP stored
 * (the address is used in memory for the rate limit and nothing else). Sets a random first-party
 * visitor id and, on a visit that came from a campaign or another site, the first-touch cookie.
 */
export async function POST(request: Request) {
  const ua = request.headers.get("user-agent");
  const purpose = `${request.headers.get("purpose") ?? ""}${request.headers.get("sec-purpose") ?? ""}`;
  if (isBot(ua, { allowHeadless: process.env.ANALYTICS_ALLOW_HEADLESS === "1" }) || /prefetch|prerender/i.test(purpose)) return new NextResponse(null, { status: 204 });
  const raw = await request.text().catch(() => "");
  if (raw.length > 2048) return NextResponse.json({ error: "too_large" }, { status: 413 });
  let body: { name?: unknown; path?: unknown; search?: unknown; referrer?: unknown; props?: unknown };
  try { body = JSON.parse(raw || "{}"); } catch { return NextResponse.json({ error: "invalid" }, { status: 400 }); }
  if (!isClientEvent(body.name)) return NextResponse.json({ error: "unknown_event" }, { status: 400 });
  const limit = hit("eventsIp", ipKey(request));
  if (!limit.ok) return new NextResponse(null, { status: 204 });

  const jar = await cookies();
  let anonId = jar.get(ANON_COOKIE)?.value ?? "";
  if (!/^[a-f0-9]{24}$/.test(anonId)) {
    anonId = randomBytes(12).toString("hex");
    jar.set(ANON_COOKIE, anonId, { path: "/", maxAge: YEAR, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  }
  const path = typeof body.path === "string" ? body.path.slice(0, 200) : "";
  const utm = utmFrom(typeof body.search === "string" ? body.search.slice(0, 500) : "");
  const ownHost = (() => { try { return new URL(publicBaseUrl()).hostname; } catch { return ""; } })();
  const refHost = refHostOf(typeof body.referrer === "string" ? body.referrer : "", ownHost);
  if ((utm.source || refHost) && !jar.get(FIRST_TOUCH_COOKIE)) {
    const ft = JSON.stringify({ s: utm.source, m: utm.medium, c: utm.campaign, t: utm.content, r: refHost, l: path, at: nowIso() });
    jar.set(FIRST_TOUCH_COOKIE, ft, { path: "/", maxAge: FIRST_TOUCH_AGE, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  }
  const props = body.props && typeof body.props === "object" ? JSON.stringify(body.props) : "{}";
  const user = await currentUser().catch(() => null);
  getDb().prepare("INSERT INTO events (ts, name, anonId, userId, path, refHost, utmSource, utmMedium, utmCampaign, utmContent, device, props) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(nowIso(), body.name, anonId, user?.id ?? null, path, refHost, utm.source, utm.medium, utm.campaign, utm.content, deviceOf(ua), props.length <= 1024 ? props : "{}");
  return new NextResponse(null, { status: 204 });
}
