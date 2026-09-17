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
  const tone: Record<string, string> = { won: "text-signal-400 border-signal-400/30", lost: "text-warn-400 border-warn-400/30", push: "text-mist-300 border-ink-700", void: "text-mist-500 border-ink-700", pending: "text-mist-400 border-ink-700" };
  const fmt = (iso?: string) => (iso ? formatDateTime(iso, lang) : "—");

  return (
    <div className="flex min-h-full flex-col bg-ink-950 text-mist-100">
      <MarketingHeader lang={lang} langHrefs={{ pt: `/p/${slug}`, en: `/p/${slug}?lang=en` }} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-5" data-testid="ticket-page">
        <Link href={{ pathname: "/prova", query: { lang } }} className="mb-6 inline-block text-[13px] text-mist-400 hover:text-mist-100">{c.back}</Link>
        <div>
        <div className={"inline-block rounded-full border px-3 py-1 text-[12px] font-semibold tracking-wider " + tone[e.outcome]}>{c.outcome[e.outcome]}</div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{scrubText(e.title, lang)}</h1>
        <p className="mt-1 text-[15px] text-mist-400">{scrubText(e.matchup, lang)}</p>
        <div className="mt-6 flex flex-wrap gap-6 text-[13px] text-mist-400">
          <span><span className="text-mist-500">{c.generated}:</span> {fmt(e.createdAt)}</span>
          <span><span className="text-mist-500">{e.outcome === "pending" ? c.pending : c.settled}:</span> {e.outcome === "pending" ? "—" : fmt(e.settledAt)}</span>
          <span className="nums"><span className="text-mist-500">odd:</span> {formatDecimal(e.combinedDecimal)}</span>
          <span className="nums"><span className="text-mist-500">{c.predicted}:</span> {(e.modelledProbability * 100).toFixed(0)}%</span>
        </div>
        <h2 className="mt-8 text-[11px] uppercase tracking-wider text-mist-500">{c.legs}</h2>
        <ul className="mt-2 divide-y divide-ink-800 rounded-xl border border-ink-800">
          {e.legs.map((l, i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-3 text-[14px]">
              <span className={"w-5 font-bold " + tone[l.outcome].split(" ")[0]}>{c.leg[l.outcome]}</span>
              <div className="min-w-0 flex-1"><p className="text-mist-100">{scrubText(l.selection, lang)}</p><p className="text-[12px] text-mist-500">{l.market} · <span className="nums">{formatDecimal(l.oddsDecimal)}</span> · {(l.predictedProbability * 100).toFixed(0)}%{l.actual ? ` · ${scrubText(l.actual, lang)}` : ""}</p></div>
            </li>
          ))}
        </ul>
        {canReview && <div className="mt-6" data-testid="ticket-review"><LossReview slug={slug} lang={lang} /></div>}
        <p className="mt-6 text-[13px] text-mist-500">{c.copy}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={`https://wa.me/?text=${encodeURIComponent(c.wa(scrubText(e.title, lang), c.outcome[e.outcome], formatDecimal(e.combinedDecimal), url))}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-signal-400/40 px-4 py-2 text-[13px] font-semibold text-signal-400 hover:bg-signal-400/10" data-testid="share-wa">{c.share}</a>
          <Link href={`/signup?lang=${lang}`} className="rounded-lg bg-edge-400 px-4 py-2 text-[13px] font-semibold text-ink-950 hover:bg-edge-500">{c.cta}</Link>
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
    <div className="flex min-h-full flex-col bg-ink-950 text-mist-100">
      <MarketingHeader lang={lang} langHrefs={{ pt: `/p/${slug}`, en: `/p/${slug}?lang=en` }} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-5" data-testid="ticket-locked">
        <Link href={{ pathname: "/prova", query: { lang } }} className="mb-6 inline-block text-[13px] text-mist-400 hover:text-mist-100">{c.back}</Link>
        <div className="inline-block rounded-full border border-ink-700 px-3 py-1 text-[12px] font-semibold tracking-wider text-mist-400">{c.outcome.pending}</div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{c.lockedTitle}</h1>
        <p className="mt-1 text-[15px] text-mist-400">{matchup}</p>
        {startsAt && <p className="mt-4 text-[13px] text-mist-400"><span className="text-mist-500">{c.kickoff}:</span> {formatDateTime(startsAt, lang)}</p>}
        <p className="mt-6 max-w-xl text-[14px] leading-relaxed text-mist-300">{c.lockedBody}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/planos?lang=${lang}`} className="rounded-lg bg-edge-400 px-4 py-2 text-[13px] font-semibold text-ink-950 hover:bg-edge-500">{c.lockedCta}</Link>
        </div>
      </main>
      <MarketingFooter lang={lang} />
    </div>
  );
}
