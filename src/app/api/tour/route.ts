import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { getOnboarding, peekOnboarding, recordEvent, setTourStep } from "@/lib/server/onboarding";
import { hit, ipKey } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
const ANON = "betmatic_anon";

/** Owner key: the user when logged in, else an anonymous cookie minted on the first POST. */
async function owner(): Promise<{ key: string; fresh: string | null }> {
  const user = await currentUser();
  if (user) return { key: user.id, fresh: null };
  const existing = (await cookies()).get(ANON)?.value;
  if (existing) return { key: existing, fresh: null };
  const id = `anon_${randomBytes(12).toString("hex")}`;
  return { key: id, fresh: id };
}
const withCookie = (res: NextResponse, fresh: string | null) => {
  if (fresh) res.cookies.set(ANON, fresh, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: process.env.NODE_ENV === "production" });
  return res;
};

/** Read-only: no row and no cookie are created here, so bots and previews do not inflate the funnel. */
export async function GET() {
  const user = await currentUser();
  const key = user?.id ?? (await cookies()).get(ANON)?.value;
  const row = key ? peekOnboarding(key) : { tourCompleted: 0, tourStep: 0 };
  return NextResponse.json({ tourCompleted: row.tourCompleted === 1, tourStep: row.tourStep });
}

const schema = z.object({ step: z.number().int().min(0).max(20).optional(), completed: z.boolean().optional(), event: z.string().max(40).optional(), meta: z.record(z.string(), z.unknown()).optional() });

export async function POST(request: Request) {
  if (!hit("tourIp", ipKey(request)).ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const o = await owner();
  const { step, completed, event, meta } = parsed.data;
  if (event) recordEvent(o.key, event, meta);
  const row = step !== undefined || completed !== undefined ? setTourStep(o.key, step ?? getOnboarding(o.key).tourStep, completed ?? false) : getOnboarding(o.key);
  return withCookie(NextResponse.json({ tourCompleted: row.tourCompleted === 1, tourStep: row.tourStep }), o.fresh);
}
