import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://betmatic.marqa.online";
  return { rules: [{ userAgent: "*", allow: ["/", "/prova", "/p/", "/jogo/", "/ferramentas"], disallow: ["/app", "/admin", "/api"] }], sitemap: `${base}/sitemap.xml` };
}
