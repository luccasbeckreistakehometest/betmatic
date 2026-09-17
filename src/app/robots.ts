import type { MetadataRoute } from "next";
import { publicBaseUrl } from "@/lib/base-url";

// The sitemap URL comes from the runtime base URL, not the (env-less) build.
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  const base = publicBaseUrl();
  return { rules: [{ userAgent: "*", allow: ["/", "/prova", "/p/", "/jogo/", "/ferramentas"], disallow: ["/app", "/admin", "/api", "/pagamento", "/login", "/signup"] }], sitemap: `${base}/sitemap.xml` };
}
