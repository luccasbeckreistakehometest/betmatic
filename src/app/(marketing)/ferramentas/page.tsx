import type { Metadata } from "next";
import { Calculators } from "@/components/Calculators";
import { MarketingPage } from "@/components/MarketingShell";
import { langFrom, langPaths, pageMetadata, type SearchProps } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: SearchProps): Promise<Metadata> {
  const lang = await langFrom(searchParams);
  return pageMetadata({
    lang,
    title: lang === "pt" ? "Calculadoras de aposta grátis: EV, múltipla e margem da casa" : "Free betting calculators: EV, parlays and the book's hold",
    description: lang === "pt"
      ? "Calculadora de valor esperado (+EV), calculadora de múltipla com a margem real da casa e conversor de odds. Grátis, sem cadastro."
      : "Expected-value calculator, parlay calculator with the book's real hold, and an odds converter. Free, no signup.",
    paths: langPaths("/ferramentas"),
  });
}

export default async function ToolsPage({ searchParams }: SearchProps) {
  const lang = await langFrom(searchParams);
  return (
    <MarketingPage lang={lang} langHrefs={langPaths("/ferramentas")} wide>
      <Calculators lang={lang} />
    </MarketingPage>
  );
}
