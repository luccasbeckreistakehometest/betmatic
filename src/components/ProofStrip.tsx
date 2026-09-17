import Link from "next/link";
import { readLedger } from "@/lib/ledger/store";
import { proofStats } from "@/lib/ledger/proof";
import { latestPredictionDateKey, servePredictions } from "@/lib/server/predictions";
import { getPlan } from "@/lib/plans";
import { SPORTS } from "@/lib/sports";
import { todayKey } from "@/lib/sources/espn";
import { formatDecimal } from "@/lib/odds";
import type { Lang } from "@/lib/i18n";
import type { BetSuggestion } from "@/lib/types";

/**
 * The landing's honesty strip: live numbers from the public ledger and, when there is one, today's
 * best-evidenced ticket exactly as a free visitor would see it (whitelabelled, free-plan bands).
 * Nothing here is written by hand, so it can never drift from the product's real record.
 */
const C = {
  pt: { eyebrow: "Prova ao vivo", generated: "bilhetes gerados", hit: "acerto", roi: "ROI a 1 unidade", all: "ver todos os bilhetes →", today: "Bilhete do dia", latest: "Último bilhete gerado", legs: "pernas", cta: "Ver as pernas grátis", none: "O primeiro bilhete de hoje aparece assim que um jogo for aberto." },
  en: { eyebrow: "Live proof", generated: "tickets generated", hit: "hit rate", roi: "ROI at 1 unit", all: "see every ticket →", today: "Ticket of the day", latest: "Latest ticket", legs: "legs", cta: "See the legs for free", none: "Today's first ticket appears as soon as a game is opened." },
};

function bestFor(dateKey: string, lang: Lang): { bet: BetSuggestion; matchup: string; gameId: string | null } | null {
  let best: { bet: BetSuggestion; matchup: string; gameId: string | null } | null = null;
  for (const s of SPORTS) {
    // The full plan's view, whitelabelled: the strip shows title, price and context — never the legs,
    // which is what the free plan's delay protects. A visitor sees what exists, not a hollowed slate.
    for (const p of servePredictions({ scope: "game", sportKey: s.key, dateKey, lang, plan: getPlan("pro"), role: "user" })) {
      for (const bet of p.slate.suggestions) if (!best || bet.evidenceScore > best.bet.evidenceScore) best = { bet, matchup: p.matchup, gameId: p.gameId };
    }
  }
  return best;
}

/** Today's best-evidenced ticket; before today has one, the latest day's, labelled as such. */
function bestToday(lang: Lang): { pick: ReturnType<typeof bestFor>; isToday: boolean } {
  const today = bestFor(todayKey(), lang);
  if (today) return { pick: today, isToday: true };
  const latest = latestPredictionDateKey();
  return { pick: latest && latest !== todayKey() ? bestFor(latest, lang) : null, isToday: false };
}

export function ProofStrip({ lang }: { lang: Lang }) {
  const c = C[lang];
  const s = proofStats(readLedger());
  const { pick: top, isToday } = bestToday(lang);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  return (
    <section className="border-b border-ink-800/80 bg-ink-900/40" data-testid="proof-strip">
      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-8 md:grid-cols-[1fr_1.2fr] md:items-center">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-edge-400">{c.eyebrow}</p>
          <div className="mt-3 flex flex-wrap gap-8">
            {[[c.generated, String(s.generated)], [c.hit, s.settled ? pct(s.hitRate) : "—"], [c.roi, s.settled ? `${s.roi >= 0 ? "+" : ""}${pct(s.roi)}` : "—"]].map(([k, v]) => (
              <div key={k}><div className="nums text-3xl font-semibold text-white">{v}</div><div className="text-[12px] text-mist-500">{k}</div></div>
            ))}
          </div>
          <Link href={{ pathname: "/prova", query: { lang } }} className="mt-3 inline-block text-[13px] text-edge-400 hover:underline">{c.all}</Link>
        </div>
        <div className="rounded-xl border border-ink-800 bg-ink-950/70 p-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-mist-500">{isToday ? c.today : c.latest}</p>
          {top ? (
            <div className="mt-2" data-testid="ticket-of-day">
              <div className="flex flex-wrap items-center gap-3"><span className="text-[15px] font-semibold text-white">{top.bet.title}</span><span className="nums rounded-lg bg-signal-500/12 px-2 py-0.5 text-[13px] font-bold text-signal-400">{formatDecimal(top.bet.combinedDecimal)}</span></div>
              <p className="mt-1 text-[13px] text-mist-400">{top.matchup} · {top.bet.legs.length} {c.legs}</p>
              <p className="mt-2 line-clamp-2 text-[13px] text-mist-300">{top.bet.background}</p>
              <Link href={{ pathname: "/signup", query: { lang } }} className="mt-3 inline-block rounded-lg bg-edge-400 px-4 py-2 text-[13px] font-semibold text-ink-950 hover:bg-edge-500">{c.cta}</Link>
            </div>
          ) : <p className="mt-2 text-[13px] text-mist-500">{c.none}</p>}
        </div>
      </div>
    </section>
  );
}
