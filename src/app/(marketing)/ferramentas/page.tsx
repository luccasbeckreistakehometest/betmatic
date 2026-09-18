import type { Metadata } from "next";
import { Calculators } from "@/components/Calculators";
import { MarketingPage } from "@/components/MarketingShell";
import Link from "next/link";
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
      <section className="mt-10 grid gap-4 md:grid-cols-2" data-testid="tools-more">
        <Link href={`/signup?lang=${lang}&next=${encodeURIComponent(`/app/bankroll?lang=${lang}`)}`} className="group rounded-panel border border-line bg-surface-1 p-5 hover:border-pos">
          <p className="text-base font-semibold text-fg group-hover:text-pos">{lang === "pt" ? "Manda o print do seu bilhete" : "Snap your slip"}</p>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            {lang === "pt"
              ? "A mesma conta das calculadoras, feita no bilhete que você já apostou: a gente lê o print, confere se as odds batem com o total e liquida sozinho quando o jogo acaba. A imagem não fica guardada."
              : "The same maths as these calculators, run on a slip you already placed: we read the screenshot, check the odds multiply to the total, and grade it when the game ends. The image is never kept."}
          </p>
        </Link>
        <Link href={lang === "pt" ? "/raio-x-tipster" : "/tipster-audit"} className="group rounded-panel border border-line bg-surface-1 p-5 hover:border-pos">
          <p className="text-base font-semibold text-fg group-hover:text-pos">{lang === "pt" ? "Raio-x do tipster" : "Tipster audit"}</p>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            {lang === "pt"
              ? "Antes de pagar grupo VIP, confira o acerto real dos palpites contra o placar oficial, inclusive os greens postados depois do jogo começar."
              : "Before paying for a VIP group, check the picks' real record against the official score, including the wins posted after kickoff."}
          </p>
        </Link>
      </section>
    </MarketingPage>
  );
}
