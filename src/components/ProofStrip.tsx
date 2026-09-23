import Link from "next/link";
import { readLedger } from "@/lib/ledger/store";
import { mainTickets, proofMinDecided, proofPublishable, proofStats, withinRecordWindow } from "@/lib/ledger/proof";
import { latestPredictionDateKey, servePredictions } from "@/lib/server/predictions";
import { getPlan } from "@/lib/plans";
import { SOLD_SPORTS } from "@/lib/sports";
import { todayKey } from "@/lib/sources/espn";
import { formatPercent } from "@/lib/format";
import { Odds, buttonClass } from "@/components/ui";
import type { Lang } from "@/lib/i18n";
import type { BetSuggestion } from "@/lib/types";
import { legsLabel, pickTeaser, teaserHeadline } from "@/lib/teaser";
import { recentFeaturedIds } from "@/lib/server/featured-store";

/**
 * The landing's honesty strip: live numbers from the public ledger and, when there is one, today's
 * best-evidenced ticket as a teaser: its shape and price, never the pick (see lib/teaser.ts).
 * Nothing here is written by hand, so it can never drift from the product's real record.
 */
const C = {
  pt: { method: "Como medimos: todo bilhete gerado fica registrado na hora e é liquidado sozinho contra o placar oficial — ganhou, perdeu ou anulou. Os números de acerto e ROI aparecem aqui quando houver pelo menos {n} bilhetes decididos; antes disso, seria sorte ou azar.", methodTitle: "Prova pública, com método", eyebrow: "Prova ao vivo", generated: "bilhetes gerados", hit: "acerto", roi: "ROI a 1 unidade", all: "ver todos os bilhetes →", today: "Bilhete do dia", latest: "Último bilhete gerado", cta: "Ver as linhas grátis", ctaPaid: "Ver planos", blurb: "As linhas e a chance medida de cada uma ficam no app.", confidence: "confiança", none: "O primeiro bilhete de hoje aparece assim que um jogo for aberto.", gamePage: "página do jogo →" },
  en: { method: "How we measure: every generated ticket is logged the moment it is built and graded automatically against the official score — won, lost or void. Hit rate and ROI appear here once at least {n} tickets are decided; before that, it would be luck.", methodTitle: "Public record, with a method", eyebrow: "Live proof", generated: "tickets generated", hit: "hit rate", roi: "ROI at 1 unit", all: "see every ticket →", today: "Ticket of the day", latest: "Latest ticket", cta: "See the legs for free", ctaPaid: "See plans", blurb: "The legs and each one's measured chance are in the app.", confidence: "confidence", none: "Today's first ticket appears as soon as a game is opened.", gamePage: "game page →" },
};

type TopPick = { bet: BetSuggestion; matchup: string; gameId: string | null; sportKey: string };

function bestFor(dateKey: string, lang: Lang, sportKeys?: string[]): (TopPick & { free: boolean }) | null {
  const all: TopPick[] = [];
  for (const s of SOLD_SPORTS.filter((x) => !sportKeys || sportKeys.includes(x.key))) {
    // The full plan's view, whitelabelled, so the strip reflects what exists; only the ticket's shape is shown.
    for (const p of servePredictions({ scope: "game", sportKey: s.key, dateKey, lang, plan: getPlan("pro"), role: "user" })) {
      for (const bet of p.slate.suggestions) all.push({ bet, matchup: p.matchup, gameId: p.gameId, sportKey: s.key });
    }
  }
  // The day's featured games come first: they are the ones picked to be shown.
  const featured = recentFeaturedIds();
  const fromFeatured = all.filter((p) => p.gameId && featured.has(p.gameId));
  return pickTeaser(fromFeatured.length ? fromFeatured : all);
}

/** Today's best-evidenced ticket; before today has one, the latest day's, labelled as such. */
function bestToday(lang: Lang, sportKeys?: string[]): { pick: ReturnType<typeof bestFor>; isToday: boolean } {
  const today = bestFor(todayKey(), lang, sportKeys);
  if (today) return { pick: today, isToday: true };
  const latest = latestPredictionDateKey();
  return { pick: latest && latest !== todayKey() ? bestFor(latest, lang, sportKeys) : null, isToday: false };
}

/** `sportKeys` narrows both the numbers and the ticket to one sport funnel. */
export function ProofStrip({ lang, sportKeys }: { lang: Lang; sportKeys?: string[] }) {
  const c = C[lang];
  const s = proofStats(mainTickets(withinRecordWindow(readLedger())).filter((e) => !sportKeys || sportKeys.includes(e.sportKey)));
  const { pick: top, isToday } = bestToday(lang, sportKeys);
  const pct = (n: number, signed = false) => formatPercent(n, lang, { signed });
  const publish = proofPublishable(s);
  return (
    <section className="border-b border-line bg-surface-1" data-testid="proof-strip">
      <div className="mx-auto grid max-w-shell gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_1.2fr] md:items-center">
        <div>
          <p className="text-label u-label text-fg-dim">{publish ? c.eyebrow : c.methodTitle}</p>
          {publish ? (
            <div className="mt-3 flex flex-wrap gap-8" data-testid="proof-numbers">
              {[[c.generated, String(s.generated)], [c.hit, pct(s.hitRate)], [c.roi, pct(s.roi, true)]].map(([k, v]) => (
                <div key={k} className="flex flex-col gap-1.5"><span className="nums text-h2 leading-none text-fg">{v}</span><span className="text-label u-label text-fg-dim">{k}</span></div>
              ))}
            </div>
          ) : (
            <p className="mt-3 max-w-md text-sm leading-relaxed text-fg-muted" data-testid="proof-method">{c.method.replace("{n}", String(proofMinDecided()))}</p>
          )}
          <Link href={{ pathname: "/prova", query: { lang } }} className="mt-4 inline-block text-sm text-fg underline decoration-line-control underline-offset-2 hover:decoration-fg">{c.all}</Link>
        </div>
        <div className="border border-line bg-surface-0 p-5">
          <p className="text-label u-label text-fg-dim">{isToday ? c.today : c.latest}</p>
          {top ? (
            <div className="mt-2" data-testid="ticket-of-day">
              <div className="flex flex-wrap items-center gap-3"><span className="text-base font-semibold text-fg">{teaserHeadline(top.bet, lang)}</span><Odds decimal={top.bet.combinedDecimal} lang={lang} className="text-sm" /></div>
              <p className="mt-1 text-sm text-fg-muted">{top.matchup} · {legsLabel(top.bet.legs.length, lang)} · <span className="nums">{c.confidence} {top.bet.evidenceScore}</span></p>
              <p className="mt-2 text-sm text-fg-muted">{c.blurb}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {top.free
                  ? <Link href={{ pathname: "/signup", query: { lang, next: top.gameId ? `/app/game/${top.gameId}?sport=${top.sportKey}&lang=${lang}` : `/app?lang=${lang}` } }} className={buttonClass("primary")}>{c.cta}</Link>
                  : <Link href={{ pathname: "/planos", query: { lang } }} className={buttonClass("primary")}>{c.ctaPaid}</Link>}
                {top.gameId && <Link href={{ pathname: `/jogo/${top.gameId}`, query: { sport: top.sportKey, lang } }} className="text-sm text-fg-muted hover:text-fg" data-testid="ticket-game-link">{c.gamePage}</Link>}
              </div>
            </div>
          ) : <p className="mt-2 text-sm text-fg-dim">{c.none}</p>}
        </div>
      </div>
    </section>
  );
}
