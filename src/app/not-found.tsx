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
    <div className="flex min-h-full flex-col bg-surface-0">
      <MarketingHeader lang={lang} langHrefs={{ pt: "/", en: "/?lang=en" }} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start px-4 py-20 sm:px-5" data-testid="not-found">
        <p className="nums text-sm text-pos">404</p>
        <h1 className="mt-2 text-[clamp(1.8rem,4vw,2.6rem)] font-semibold tracking-[-0.02em] text-fg">{c.title}</h1>
        <p className="mt-3 text-base leading-relaxed text-fg-muted">{c.body}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={`/${q}`} className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap bg-action text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover active:bg-action-active disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-faint">{c.home}</Link>
          <Link href={`/app${q}`} className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap border border-line-control text-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-surface-2 active:bg-surface-3 disabled:cursor-not-allowed disabled:border-line disabled:text-fg-faint">{c.app}</Link>
          <Link href={`/prova${q}`} className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap border border-line-control text-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-surface-2 active:bg-surface-3 disabled:cursor-not-allowed disabled:border-line disabled:text-fg-faint">{c.proof}</Link>
          <Link href={`/contato${q}`} className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap border border-line-control text-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-surface-2 active:bg-surface-3 disabled:cursor-not-allowed disabled:border-line disabled:text-fg-faint">{c.contact}</Link>
        </div>
      </main>
      <MarketingFooter lang={lang} />
    </div>
  );
}
