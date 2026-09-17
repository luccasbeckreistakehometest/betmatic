import type { MetadataRoute } from "next";
import { publicBaseUrl } from "@/lib/base-url";
export default function robots(): MetadataRoute.Robots {
  const base = publicBaseUrl();
  return { rules: [{ userAgent: "*", allow: ["/", "/prova", "/p/", "/jogo/", "/ferramentas"], disallow: ["/app", "/admin", "/api", "/pagamento", "/login", "/signup"] }], sitemap: `${base}/sitemap.xml` };
}
