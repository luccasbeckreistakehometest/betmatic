import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { LangSwitch } from "@/components/LangSwitch";
import { LegalLinks } from "@/components/LegalLinks";
import { LinkButton } from "@/components/ui";
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

/**
 * The public pages are the same system at a lower density (§7): identical ramp, identical rules,
 * identical numerals, more air and a longer measure. The marketing grid is 12 columns inside a
 * 1240px shell, and the header is a single 56px rule — no shadow, nothing floating.
 */
export function MarketingHeader({ lang, langHrefs, nav }: { lang: Lang; langHrefs: Record<Lang, string>; nav?: ReactNode }) {
  const c = COPY[lang];
  const q = lang === "en" ? "?lang=en" : "";
  const link = "text-sm text-fg-muted transition-colors duration-(--dur-1) hover:text-fg";
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface-0">
      <div className="mx-auto flex h-14 max-w-shell items-center gap-4 px-4 sm:gap-8 sm:px-6">
        <Link href={`/${q}`} aria-label="Betmatic" className="shrink-0">
          <span className="sm:hidden"><Logo size={22} showWord={false} /></span>
          <span className="hidden sm:inline"><Logo size={22} /></span>
        </Link>
        {nav ?? (
          <nav className="hidden items-center gap-6 md:flex">
            <Link href={`/prova${q}`} className={link}>{c.proof}</Link>
            <Link href={`/planos${q}`} className={link}>{c.plans}</Link>
            <Link href={`/ferramentas${q}`} className={link}>{c.tools}</Link>
          </nav>
        )}
        <div className="ml-auto flex items-center gap-2 sm:gap-4">
          <LangSwitch lang={lang} hrefs={langHrefs} />
          <Link href={`/login?lang=${lang}`} className={`${link} whitespace-nowrap`} data-testid="landing-login">
            {c.login}
          </Link>
          <LinkButton variant="primary" href={`/signup?lang=${lang}`} className="whitespace-nowrap">
            {c.start}
          </LinkButton>
        </div>
      </div>
    </header>
  );
}

/** Footer of every public page: disclaimers, legal pages, contact and (when configured) support. */
export function MarketingFooter({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const support = supportChannels();
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-shell gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_2fr]">
        <div>
          <Logo size={20} />
          {(support.email || support.whatsapp) && (
            <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-tiny" data-testid="support-channels">
              <span className="text-fg-muted">{c.support}:</span>
              {support.email && <a href={`mailto:${support.email}`} className="text-fg-muted underline-offset-2 hover:underline">{support.email}</a>}
              {support.whatsapp && <a href={`https://wa.me/${support.whatsapp}`} rel="noopener" className="text-fg-muted underline-offset-2 hover:underline">WhatsApp</a>}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-3 text-tiny leading-relaxed text-fg-dim">
          <LegalLinks lang={lang} />
          <p className="max-w-measure-legal">{c.note}</p>
          {/* Caution, not error: an 18+ notice is a standing condition of the product (§13). */}
          <p className="max-w-measure-legal border-l-2 border-warn pl-3 text-warn">{c.responsible}</p>
        </div>
      </div>
    </footer>
  );
}

/** A simple public page: header, a readable column, footer. */
export function MarketingPage({ lang, langHrefs, children, wide = false }: { lang: Lang; langHrefs: Record<Lang, string>; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-full flex-col bg-surface-0" data-density="comfortable">
      <MarketingHeader lang={lang} langHrefs={langHrefs} />
      <main className={`mx-auto w-full flex-1 px-4 py-12 sm:px-6 sm:py-16 ${wide ? "max-w-shell" : "max-w-measure-legal"}`}>{children}</main>
      <MarketingFooter lang={lang} />
    </div>
  );
}
