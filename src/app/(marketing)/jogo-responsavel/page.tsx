import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { responsibleDoc } from "@/lib/legal/responsible";
import { pageMetadata } from "@/lib/seo";

// Identity and support lines come from runtime env (the image is built without .env).
export const dynamic = "force-dynamic";

const PATHS = { pt: "/jogo-responsavel", en: "/responsible-gambling" };

export function generateMetadata(): Metadata {
  const doc = responsibleDoc("pt");
  return pageMetadata({ lang: "pt", title: doc.title, description: doc.description, paths: PATHS });
}

export default function Page() {
  return <LegalPage doc={responsibleDoc("pt")} lang="pt" langHrefs={PATHS} testId="legal-responsible" />;
}
