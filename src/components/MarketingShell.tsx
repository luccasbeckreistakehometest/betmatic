import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { LangSwitch } from "@/components/LangSwitch";
import { LegalLinks } from "@/components/LegalLinks";
import type { Lang } from "@/lib/i18n";
import { supportChannels } from "@/lib/support";

const COPY = {
  pt: { login: "Entrar", start: "Começar de graça", proof: "Prova", tools: "Ferramentas", plans: "Planos",
    note: "Ferramenta de pesquisa. O Betmatic não aceita apostas nem intermedia pagamentos a casas de apostas. Dados agregados podem estar errados ou desatualizados — confirme a linha na sua casa antes de apostar. Nada aqui é recomendação.",
    responsible: "Proibido para menores de 18 anos. Aposta não é investimento nem fonte de renda. Se deixar de ser diversão, pare e procure ajuda: CVV 188 (ligação gratuita, 24 h).",
    support: "Suporte" },
  en: { login: "Log in", start: "Start free", proof: "Track record", tools: "Free tools", plans: "Pricing",
    note: "Research tool. Betmatic does not take bets or process payments to sportsbooks. Aggregated data can be wrong or stale — verify a line at your book before acting. Nothing here is advice.",
    responsible: "18+ only (21+ where the law requires). Betting is not investing or income. If it stops being fun, stop and get help: 1-800-MY-RESET (US) or GamCare 0808 8020 133 (UK).",
    support: "Support" },
};

/** Header of every public page. "Entrar" stays visible on phones. */
export function MarketingHeader({ lang, langHrefs, nav }: { lang: Lang; langHrefs: Record<Lang, string>; nav?: ReactNode }) {
  const c = COPY[lang];
  const q = lang === "en" ? "?lang=en" : "";
  return (
    <header className="sticky top-0 z-40 border-b border-ink-800/80 bg-ink-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3.5 sm:gap-6 sm:px-5">
        <Link href={`/${q}`} aria-label="Betmatic" className="shrink-0">
          <span className="sm:hidden"><Logo size={24} showWord={false} /></span>
          <span className="hidden sm:inline"><Logo size={26} /></span>
        </Link>
        {nav ?? (
          <nav className="ml-2 hidden items-center gap-5 text-[13px] text-mist-400 md:flex">
            <Link href={`/prova${q}`} className="transition hover:text-mist-100">{c.proof}</Link>
            <Link href={`/planos${q}`} className="transition hover:text-mist-100">{c.plans}</Link>
            <Link href={`/ferramentas${q}`} className="transition hover:text-mist-100">{c.tools}</Link>
          </nav>
        )}
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <LangSwitch lang={lang} hrefs={langHrefs} />
          <Link href={`/login?lang=${lang}`} className="whitespace-nowrap text-[13px] text-mist-300 transition hover:text-mist-100" data-testid="landing-login">
            {c.login}
          </Link>
          <Link href={`/signup?lang=${lang}`} className="whitespace-nowrap rounded-lg bg-edge-400 px-3 py-1.5 text-[13px] font-semibold text-ink-950 transition hover:bg-edge-500 sm:px-3.5">
            {c.start}
          </Link>
        </div>
      </div>
    </header>
  );
}

/** Footer of every public page: disclaimers, legal pages, contact and (when configured) support channels. */
export function MarketingFooter({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const support = supportChannels();
  return (
    <footer className="border-t border-ink-800/80 px-4 py-8 sm:px-5">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 text-[11.5px] leading-relaxed text-mist-500">
        <Logo size={20} />
        <LegalLinks lang={lang} className="mt-1" />
        {(support.email || support.whatsapp) && (
          <p className="flex flex-wrap gap-x-4 gap-y-1" data-testid="support-channels">
            <span className="text-mist-400">{c.support}:</span>
            {support.email && <a href={`mailto:${support.email}`} className="text-mist-300 hover:underline">{support.email}</a>}
            {support.whatsapp && <a href={`https://wa.me/${support.whatsapp}`} rel="noopener" className="text-mist-300 hover:underline">WhatsApp</a>}
          </p>
        )}
        <p className="max-w-3xl">{c.note}</p>
        <p className="max-w-3xl">{c.responsible}</p>
      </div>
    </footer>
  );
}

/** A simple public page: header, a readable column, footer. */
export function MarketingPage({ lang, langHrefs, children, wide = false }: { lang: Lang; langHrefs: Record<Lang, string>; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-full flex-col bg-ink-950">
      <MarketingHeader lang={lang} langHrefs={langHrefs} />
      <main className={`mx-auto w-full flex-1 px-4 py-10 sm:px-5 sm:py-14 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>{children}</main>
      <MarketingFooter lang={lang} />
    </div>
  );
}
