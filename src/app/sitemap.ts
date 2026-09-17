import type { MetadataRoute } from "next";
import { SPORT_LANDINGS } from "@/lib/sport-landing";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://betmatic.marqa.online";
  const now = new Date();
  const pages = ["", "/prova", "/ferramentas", "/signup", ...SPORT_LANDINGS.map((s) => `/${s.slug}`)];
  return pages.flatMap((p) => [
    { url: `${base}${p}`, lastModified: now, changeFrequency: "daily" as const, priority: p === "" ? 1 : 0.7 },
    { url: `${base}${p}?lang=en`, lastModified: now, changeFrequency: "daily" as const, priority: 0.5 },
  ]);
}
