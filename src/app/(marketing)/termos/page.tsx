import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { termsDoc } from "@/lib/legal/terms";
import { pageMetadata } from "@/lib/seo";

// Identity and support lines come from runtime env (the image is built without .env).
export const dynamic = "force-dynamic";

const PATHS = { pt: "/termos", en: "/terms" };

export function generateMetadata(): Metadata {
  const doc = termsDoc("pt");
  return pageMetadata({ lang: "pt", title: doc.title, description: doc.description, paths: PATHS });
}

export default function Page() {
  return <LegalPage doc={termsDoc("pt")} lang="pt" langHrefs={PATHS} testId="legal-terms" />;
}
