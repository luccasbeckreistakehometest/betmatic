import Link from "next/link";
import { readLedger } from "@/lib/ledger/store";
import { mainTickets, proofMinDecided, proofPublishable, proofStats } from "@/lib/ledger/proof";
import { latestPredictionDateKey, servePredictions } from "@/lib/server/predictions";
import { getPlan } from "@/lib/plans";
import { SOLD_SPORTS } from "@/lib/sports";
import { todayKey } from "@/lib/sources/espn";
import { formatDecimal } from "@/lib/odds";
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
  pt: { method: "Como medimos: todo bilhete gerado fica registrado na hora e é liquidado sozinho contra o placar oficial — ganhou, perdeu ou anulou. Os números de acerto e ROI aparecem aqui quando houver pelo menos {n} bilhetes decididos; antes disso, seria sorte ou azar.", methodTitle: "Prova pública, com método", eyebrow: "Prova ao vivo", generated: "bilhetes gerados", hit: "acerto", roi: "ROI a 1 unidade", all: "ver todos os bilhetes →", today: "Bilhete do dia", latest: "Último bilhete gerado", cta: "Ver as pernas grátis", ctaPaid: "Ver planos", blurb: "As pernas e a chance medida de cada uma ficam no app.", confidence: "confiança", none: "O primeiro bilhete de hoje aparece assim que um jogo for aberto.", gamePage: "página do jogo →" },
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
  const s = proofStats(mainTickets(readLedger()).filter((e) => !sportKeys || sportKeys.includes(e.sportKey)));
  const { pick: top, isToday } = bestToday(lang, sportKeys);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const publish = proofPublishable(s);
  return (
    <section className="border-b border-ink-800/80 bg-ink-900/40" data-testid="proof-strip">
      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-8 md:grid-cols-[1fr_1.2fr] md:items-center">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-edge-400">{publish ? c.eyebrow : c.methodTitle}</p>
          {publish ? (
            <div className="mt-3 flex flex-wrap gap-8" data-testid="proof-numbers">
              {[[c.generated, String(s.generated)], [c.hit, pct(s.hitRate)], [c.roi, `${s.roi >= 0 ? "+" : ""}${pct(s.roi)}`]].map(([k, v]) => (
                <div key={k}><div className="nums text-3xl font-semibold text-white">{v}</div><div className="text-[12px] text-mist-500">{k}</div></div>
              ))}
            </div>
          ) : (
            <p className="mt-3 max-w-md text-[13.5px] leading-relaxed text-mist-300" data-testid="proof-method">{c.method.replace("{n}", String(proofMinDecided()))}</p>
          )}
          <Link href={{ pathname: "/prova", query: { lang } }} className="mt-3 inline-block text-[13px] text-edge-400 hover:underline">{c.all}</Link>
        </div>
        <div className="rounded-xl border border-ink-800 bg-ink-950/70 p-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-mist-500">{isToday ? c.today : c.latest}</p>
          {top ? (
            <div className="mt-2" data-testid="ticket-of-day">
              <div className="flex flex-wrap items-center gap-3"><span className="text-[15px] font-semibold text-white">{teaserHeadline(top.bet, lang)}</span><span className="nums rounded-lg bg-signal-500/12 px-2 py-0.5 text-[13px] font-bold text-signal-400">{formatDecimal(top.bet.combinedDecimal)}</span></div>
              <p className="mt-1 text-[13px] text-mist-400">{top.matchup} · {legsLabel(top.bet.legs.length, lang)} · <span className="nums">{c.confidence} {top.bet.evidenceScore}</span></p>
              <p className="mt-2 text-[13px] text-mist-300">{c.blurb}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {top.free
                  ? <Link href={{ pathname: "/signup", query: { lang, next: top.gameId ? `/app/game/${top.gameId}?sport=${top.sportKey}&lang=${lang}` : `/app?lang=${lang}` } }} className="inline-block rounded-lg bg-edge-400 px-4 py-2 text-[13px] font-semibold text-ink-950 hover:bg-edge-500">{c.cta}</Link>
                  : <Link href={{ pathname: "/planos", query: { lang } }} className="inline-block rounded-lg bg-edge-400 px-4 py-2 text-[13px] font-semibold text-ink-950 hover:bg-edge-500">{c.ctaPaid}</Link>}
                {top.gameId && <Link href={{ pathname: `/jogo/${top.gameId}`, query: { sport: top.sportKey, lang } }} className="text-[13px] text-mist-400 hover:text-mist-100" data-testid="ticket-game-link">{c.gamePage}</Link>}
              </div>
            </div>
          ) : <p className="mt-2 text-[13px] text-mist-500">{c.none}</p>}
        </div>
      </div>
    </section>
  );
}
