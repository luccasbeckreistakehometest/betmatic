import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { privacyDoc } from "@/lib/legal/privacy";
import { pageMetadata } from "@/lib/seo";

// Identity and support lines come from runtime env (the image is built without .env).
export const dynamic = "force-dynamic";

const PATHS = { pt: "/privacidade", en: "/privacy" };

export function generateMetadata(): Metadata {
  const doc = privacyDoc("pt");
  return pageMetadata({ lang: "pt", title: doc.title, description: doc.description, paths: PATHS });
}

export default function Page() {
  return <LegalPage doc={privacyDoc("pt")} lang="pt" langHrefs={PATHS} testId="legal-privacy" />;
}
