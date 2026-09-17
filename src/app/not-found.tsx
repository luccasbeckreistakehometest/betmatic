import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { MarketingFooter, MarketingHeader } from "@/components/MarketingShell";

export const metadata: Metadata = { title: "404", robots: { index: false, follow: true } };

const C = {
  pt: { title: "Esta página não existe", body: "O link pode estar errado ou a página mudou de lugar. Um jogo antigo também pode ter saído da lista.", home: "Ir para o início", app: "Ver os jogos de hoje", proof: "Prova pública", contact: "Falar com a gente" },
  en: { title: "This page doesn't exist", body: "The link may be wrong or the page may have moved. An old game may also have left the list.", home: "Go to the home page", app: "See today's games", proof: "Public record", contact: "Contact us" },
};

export default async function NotFound() {
  const lang = (await headers()).get("x-bm-lang") === "en" ? "en" : "pt";
  const c = C[lang];
  const q = lang === "en" ? "?lang=en" : "";
  return (
    <div className="flex min-h-full flex-col bg-ink-950">
      <MarketingHeader lang={lang} langHrefs={{ pt: "/", en: "/?lang=en" }} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start px-4 py-20 sm:px-5" data-testid="not-found">
        <p className="nums text-[13px] text-edge-400">404</p>
        <h1 className="mt-2 text-[clamp(1.8rem,4vw,2.6rem)] font-semibold tracking-[-0.02em] text-white">{c.title}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-mist-400">{c.body}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={`/${q}`} className="rounded-lg bg-edge-400 px-4 py-2.5 text-[14px] font-semibold text-ink-950 hover:bg-edge-500">{c.home}</Link>
          <Link href={`/app${q}`} className="rounded-lg border border-ink-700 px-4 py-2.5 text-[14px] text-mist-200 hover:border-ink-600">{c.app}</Link>
          <Link href={`/prova${q}`} className="rounded-lg border border-ink-700 px-4 py-2.5 text-[14px] text-mist-200 hover:border-ink-600">{c.proof}</Link>
          <Link href={`/contato${q}`} className="rounded-lg border border-ink-700 px-4 py-2.5 text-[14px] text-mist-200 hover:border-ink-600">{c.contact}</Link>
        </div>
      </main>
      <MarketingFooter lang={lang} />
    </div>
  );
}
