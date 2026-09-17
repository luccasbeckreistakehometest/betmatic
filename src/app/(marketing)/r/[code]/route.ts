import { NextResponse } from "next/server";
import { REF_COOKIE } from "@/lib/server/referral";

/** Share link: remembers who sent the visitor, then lands them on signup. */
export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang") ?? "pt";
  const res = NextResponse.redirect(new URL(`/signup?lang=${lang}&ref=${encodeURIComponent(code)}`, url.origin));
  res.cookies.set(REF_COOKIE, code.slice(0, 16), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
