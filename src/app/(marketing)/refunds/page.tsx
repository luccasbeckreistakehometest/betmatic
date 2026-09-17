import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { refundsDoc } from "@/lib/legal/refunds";
import { pageMetadata } from "@/lib/seo";

// Identity and support lines come from runtime env (the image is built without .env).
export const dynamic = "force-dynamic";

const PATHS = { pt: "/reembolso", en: "/refunds" };

export function generateMetadata(): Metadata {
  const doc = refundsDoc("en");
  return pageMetadata({ lang: "en", title: doc.title, description: doc.description, paths: PATHS });
}

export default function Page() {
  return <LegalPage doc={refundsDoc("en")} lang="en" langHrefs={PATHS} testId="legal-refunds" />;
}
