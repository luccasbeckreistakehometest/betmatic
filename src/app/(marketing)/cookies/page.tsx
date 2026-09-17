import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { cookiesDoc } from "@/lib/legal/cookies";
import { langFrom, langPaths, pageMetadata, type SearchProps } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: SearchProps): Promise<Metadata> {
  const lang = await langFrom(searchParams);
  const doc = cookiesDoc(lang);
  return pageMetadata({ lang, title: doc.title, description: doc.description, paths: langPaths("/cookies") });
}

export default async function CookiesPage({ searchParams }: SearchProps) {
  const lang = await langFrom(searchParams);
  return <LegalPage doc={cookiesDoc(lang)} lang={lang} langHrefs={langPaths("/cookies")} testId="legal-cookies" />;
}
