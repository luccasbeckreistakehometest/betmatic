import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingFooter, MarketingHeader } from "@/components/MarketingShell";
import { formatDateTime } from "@/lib/format";
import { readLedger } from "@/lib/ledger/store";
import { findBySlug, isPublicTicket } from "@/lib/ledger/proof";
import { scrubText } from "@/lib/server/whitelabel";
import { normaliseLang } from "@/lib/i18n";
import { formatDecimal } from "@/lib/odds";
import { LossReview } from "@/components/LossReview";
import { currentUser } from "@/lib/server/session";
import { userHasTicket } from "@/lib/server/bankroll";
import { publicBaseUrl } from "@/lib/base-url";

export const dynamic = "force-dynamic";

const C = {
  pt: { lockedTitle: "Este bilhete abre quando a bola rolar", lockedBody: "Até o jogo começar, as pernas e as odds deste bilhete ficam só para quem tem o plano. Depois do início ele aparece aqui para todo mundo, e o resultado fica registrado, ganhe ou perca.", kickoff: "Início", lockedCta: "Ver planos",
    back: "← Prova pública", generated: "Gerado em", settled: "Liquidado em", pending: "Aguardando o jogo", predicted: "probabilidade estimada", legs: "Pernas", share: "Compartilhar no WhatsApp", copy: "Este bilhete tem um link fixo: o resultado fica aqui, ganhe ou perca.", cta: "Ver os bilhetes de hoje",
    outcome: { won: "GANHOU", lost: "PERDEU", push: "PUSH", void: "ANULADO", pending: "PENDENTE" }, leg: { won: "✓", lost: "✗", push: "=", void: "–", pending: "·" },
    wa: (t: string, o: string, odds: string, url: string) => `Bilhete Betmatic — ${t}\n${odds} · ${o}\n${url}` },
  en: { lockedTitle: "This ticket opens at kickoff", lockedBody: "Until the game starts, this ticket's legs and odds are for plan members only. Once it kicks off it appears here for everyone, and the result stays on record, win or lose.", kickoff: "Kickoff", lockedCta: "See plans",
    back: "← Track record", generated: "Generated", settled: "Settled", pending: "Awaiting kickoff", predicted: "estimated probability", legs: "Legs", share: "Share on WhatsApp", copy: "This ticket has a permanent link: the result stays here, win or lose.", cta: "See today's tickets",
    outcome: { won: "WON", lost: "LOST", push: "PUSH", void: "VOID", pending: "PENDING" }, leg: { won: "✓", lost: "✗", push: "=", void: "–", pending: "·" },
    wa: (t: string, o: string, odds: string, url: string) => `Betmatic ticket — ${t}\n${odds} · ${o}\n${url}` },
};

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const { slug } = await params;
  const lang = normaliseLang(typeof (await searchParams).lang === "string" ? ((await searchParams).lang as string) : undefined);
  const e = findBySlug(readLedger(), slug);
  if (!e) return { title: lang === "pt" ? "Bilhete não encontrado" : "Ticket not found", robots: { index: false } };
  if (!isPublicTicket(e) && (await currentUser())?.role !== "admin") {
    return { title: C[lang].lockedTitle, description: `${scrubText(e.matchup, lang)}. ${C[lang].lockedBody}`, robots: { index: false } };
  }
  const title = `${scrubText(e.title, lang)} — ${C[lang].outcome[e.outcome]}`;
  const description = `${scrubText(e.matchup, lang)} · ${formatDecimal(e.combinedDecimal)} · ${e.legs.length} ${lang === "pt" ? "pernas" : "legs"}. ${C[lang].copy}`;
  const path = `/p/${slug}`;
  return {
    title,
    description,
    alternates: { canonical: lang === "en" ? `${path}?lang=en` : path, languages: { "pt-BR": path, en: `${path}?lang=en`, "x-default": path } },
    openGraph: { title, description, url: lang === "en" ? `${path}?lang=en` : path, type: "article", siteName: "Betmatic" },
  };
}

export default async function TicketPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const q = await searchParams;
  const lang = normaliseLang(typeof q.lang === "string" ? q.lang : undefined);
  const c = C[lang];
  const e = findBySlug(readLedger(), slug);
  if (!e) notFound();
  // "Why did it lose?" is for the people who followed the ticket: the admin, or anyone with it in their bankroll.
  const viewer = await currentUser();
  if (!isPublicTicket(e) && viewer?.role !== "admin") return <LockedTicket lang={lang} slug={slug} matchup={scrubText(e.matchup, lang)} startsAt={e.startsAt} />;
  const canReview = e.outcome === "lost" && !!viewer && (viewer.role === "admin" || userHasTicket(viewer.id, e.id));
  const base = publicBaseUrl();
  const url = `${base}/p/${slug}?lang=${lang}`;
  const tone: Record<string, string> = { won: "text-pos border-pos", lost: "text-neg border-neg", push: "text-fg-muted border-line-strong", void: "text-fg-dim border-line-strong", pending: "text-fg-muted border-line-strong" };
  const fmt = (iso?: string) => (iso ? formatDateTime(iso, lang) : "—");

  return (
    <div className="flex min-h-full flex-col bg-surface-0 text-fg">
      <MarketingHeader lang={lang} langHrefs={{ pt: `/p/${slug}`, en: `/p/${slug}?lang=en` }} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-5" data-testid="ticket-page">
        <Link href={{ pathname: "/prova", query: { lang } }} className="mb-6 inline-block text-sm text-fg-muted hover:text-fg">{c.back}</Link>
        <div>
        <div className={"inline-block rounded-control border px-3 py-1 text-label u-label " + tone[e.outcome]}>{c.outcome[e.outcome]}</div>
        <h1 className="mt-4 text-h2 font-semibold tracking-tight">{scrubText(e.title, lang)}</h1>
        <p className="mt-1 text-base text-fg-muted">{scrubText(e.matchup, lang)}</p>
        <div className="mt-6 flex flex-wrap gap-6 text-sm text-fg-muted">
          <span><span className="text-fg-dim">{c.generated}:</span> {fmt(e.createdAt)}</span>
          <span><span className="text-fg-dim">{e.outcome === "pending" ? c.pending : c.settled}:</span> {e.outcome === "pending" ? "—" : fmt(e.settledAt)}</span>
          <span className="nums"><span className="text-fg-dim">odd:</span> {formatDecimal(e.combinedDecimal)}</span>
          <span className="nums"><span className="text-fg-dim">{c.predicted}:</span> {(e.modelledProbability * 100).toFixed(0)}%</span>
        </div>
        <h2 className="mt-8 text-label u-label text-fg-dim">{c.legs}</h2>
        <ul className="mt-2 divide-y divide-line rounded-panel border border-line">
          {e.legs.map((l, i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-3 text-base">
              <span className={"w-5 font-bold " + tone[l.outcome].split(" ")[0]}>{c.leg[l.outcome]}</span>
              <div className="min-w-0 flex-1"><p className="text-fg">{scrubText(l.selection, lang)}</p><p className="text-tiny text-fg-dim">{l.market} · <span className="nums">{formatDecimal(l.oddsDecimal)}</span> · {(l.predictedProbability * 100).toFixed(0)}%{l.actual ? ` · ${scrubText(l.actual, lang)}` : ""}</p></div>
            </li>
          ))}
        </ul>
        {canReview && <div className="mt-6" data-testid="ticket-review"><LossReview slug={slug} lang={lang} /></div>}
        <p className="mt-6 text-sm text-fg-dim">{c.copy}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={`https://wa.me/?text=${encodeURIComponent(c.wa(scrubText(e.title, lang), c.outcome[e.outcome], formatDecimal(e.combinedDecimal), url))}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-(--row-h) items-center rounded-control border border-line-control px-4 text-sm font-medium text-fg transition-colors duration-(--dur-1) hover:bg-surface-2" data-testid="share-wa">{c.share}</a>
          <Link href={`/signup?lang=${lang}`} className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap bg-action text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover active:bg-action-active disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-faint">{c.cta}</Link>
        </div>
        </div>
      </main>
      <MarketingFooter lang={lang} />
    </div>
  );
}

/** A ticket whose game has not started: only the matchup and kickoff, never the pick. */
function LockedTicket({ lang, slug, matchup, startsAt }: { lang: "pt" | "en"; slug: string; matchup: string; startsAt?: string }) {
  const c = C[lang];
  return (
    <div className="flex min-h-full flex-col bg-surface-0 text-fg">
      <MarketingHeader lang={lang} langHrefs={{ pt: `/p/${slug}`, en: `/p/${slug}?lang=en` }} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-5" data-testid="ticket-locked">
        <Link href={{ pathname: "/prova", query: { lang } }} className="mb-6 inline-block text-sm text-fg-muted hover:text-fg">{c.back}</Link>
        <div className="inline-block rounded-control border border-line-strong px-3 py-1 text-label u-label text-fg-muted">{c.outcome.pending}</div>
        <h1 className="mt-4 text-h2 font-semibold tracking-tight">{c.lockedTitle}</h1>
        <p className="mt-1 text-base text-fg-muted">{matchup}</p>
        {startsAt && <p className="mt-4 text-sm text-fg-muted"><span className="text-fg-dim">{c.kickoff}:</span> {formatDateTime(startsAt, lang)}</p>}
        <p className="mt-6 max-w-xl text-base leading-relaxed text-fg-muted">{c.lockedBody}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/planos?lang=${lang}`} className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap bg-action text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover active:bg-action-active disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-faint">{c.lockedCta}</Link>
        </div>
      </main>
      <MarketingFooter lang={lang} />
    </div>
  );
}
