import { NextResponse, type NextRequest } from "next/server";

/** English-only public paths; everything else is Portuguese unless ?lang=en. */
const EN_PATHS = new Set(["/basketball", "/soccer", "/tipster-audit", "/terms", "/privacy", "/refunds", "/responsible-gambling"]);

/**
 * Tells the root layout which language the page is in, so <html lang> and the default metadata are
 * right on the first byte (search engines read that, not the client-side toggle).
 */
export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const lang = searchParams.get("lang") === "en" || EN_PATHS.has(pathname) ? "en" : "pt";
  const headers = new Headers(request.headers);
  headers.set("x-bm-lang", lang);
  headers.set("x-bm-path", pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon|apple-icon|opengraph-image|robots.txt|sitemap.xml|.*\\.(?:png|svg|jpg|ico|webp)$).*)"],
};
