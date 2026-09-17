import Link from "next/link";
import type { Metadata } from "next";
import { MarketingPage } from "@/components/MarketingShell";
import { langFrom, langPaths, pageMetadata, type SearchProps } from "@/lib/seo";
import { formatDate } from "@/lib/format";
import { readLedger } from "@/lib/ledger/store";
import { mainTickets, proofMinDecided, proofPublishable, proofStats, publicTickets, recentTickets, ticketSlug } from "@/lib/ledger/proof";
import { scrubText } from "@/lib/server/whitelabel";
import { EquityChart } from "@/components/EquityChart";
import { ClvBlock } from "@/components/ClvBlock";
import { toRows } from "@/lib/ledger/backtest";
import { normaliseLang } from "@/lib/i18n";
import { formatDecimal } from "@/lib/odds";

export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: SearchProps): Promise<Metadata> {
  const lang = await langFrom(searchParams);
  return pageMetadata({
    lang,
    title: lang === "pt" ? "Prova pública: todos os bilhetes, liquidados sozinhos" : "Public track record: every ticket, graded automatically",
    description: lang === "pt"
      ? "Histórico público e verificável: cada bilhete gerado é liquidado contra o resultado oficial, com taxa de acerto e ROI a stake fixo. Nada é escolhido a dedo."
      : "A public, verifiable record: every generated ticket is graded against the official result, with hit rate and flat-stake ROI. Nothing is cherry-picked.",
    paths: langPaths("/prova"),
  });
}

const C = {
  pt: { eyebrow: "Prova pública", title: "Todos os bilhetes. Nenhum escondido.", sub: "Cada bilhete que o Betmatic gera fica registrado no momento em que nasce, aparece aqui quando o jogo começa e é liquidado sozinho contra o placar real. Sem seleção, sem editar depois. Se um dia ficar feio, vai ficar feio aqui também.",
    generated: "gerados", settled: "liquidados", hit: "acerto", roi: "ROI a 1 unidade", pending: "aguardando jogo", byMarket: "Por mercado", bySport: "Por esporte", byBand: "Por faixa de odd", recent: "Últimos bilhetes", none: "Ainda não há bilhete liquidado. O primeiro aparece assim que um jogo com bilhete terminar.",
    won: "ganhou", lost: "perdeu", push: "push", void: "anulado", pend: "pendente", cta: "Ver os bilhetes de hoje", csv: "Baixar tudo em CSV", legs: "pernas", small: "Amostra pequena: menos de 30 bilhetes decididos ainda não diz nada sobre o longo prazo.", unit: "u", method: "Os números agregados (acerto, ROI, curva) aparecem quando houver pelo menos {n} bilhetes decididos. Até lá, a lista abaixo mostra cada bilhete e o seu resultado, sem filtro.", withAlts: "Incluir as alternativas", mainOnly: "Só os bilhetes principais", methodTitle: "Como medimos", methodBody: "Todo bilhete é salvo no momento em que é gerado, com as odds e a chance estimada, e fica visível para todo mundo assim que a bola rola. Quando o jogo termina, cada perna é conferida contra o placar e as estatísticas oficiais: se não dá para conferir com certeza, a perna é anulada — nunca chutada. O ROI considera 1 unidade apostada em cada bilhete decidido." },
  en: { eyebrow: "Public track record", title: "Every ticket. None hidden.", sub: "Every ticket Betmatic generates is logged the moment it is born, shows up here once its game kicks off, and is graded automatically against the real score. No curation, no edits after the fact. If it ever looks bad, it looks bad here too.",
    generated: "generated", settled: "settled", hit: "hit rate", roi: "ROI at 1 unit", pending: "awaiting kickoff", byMarket: "By market", bySport: "By sport", byBand: "By odds band", recent: "Latest tickets", none: "No settled ticket yet. The first one appears once a game with a ticket ends.",
    won: "won", lost: "lost", push: "push", void: "void", pend: "pending", cta: "See today's tickets", csv: "Download everything as CSV", legs: "legs", small: "Small sample: fewer than 30 decided tickets says nothing about the long run.", unit: "u", method: "Aggregate numbers (hit rate, ROI, curve) appear once at least {n} tickets are decided. Until then, the list below shows every ticket and its result, unfiltered.", withAlts: "Include the alternatives", mainOnly: "Main tickets only", methodTitle: "How we measure", methodBody: "Every ticket is saved the moment it is generated, with its odds and modelled probability, and becomes visible to everyone at kickoff. When the game ends, each leg is checked against the official score and stats: if it cannot be graded with certainty, the leg is voided — never guessed. ROI assumes 1 unit staked on every decided ticket." },
};

export default async function ProofPage({ searchParams }: SearchProps) {
  const q = await searchParams;
  const lang = normaliseLang(typeof q.lang === "string" ? q.lang : undefined);
  const c = C[lang];
  const withAlternatives = q.alts === "1";
  const entries = mainTickets(readLedger(), withAlternatives);
  const s = proofStats(entries);
  // Counts cover everything; a ticket's content appears only once its game has started.
  const visible = publicTickets(entries);
  const recent = recentTickets(visible, 40);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const roiTone = (r: number) => (r > 0 ? "text-signal-400" : r < 0 ? "text-warn-400" : "text-mist-300");
  const outcomeLabel: Record<string, string> = { won: c.won, lost: c.lost, push: c.push, void: c.void, pending: c.pend };
  const publish = proofPublishable(s);
  const outcomeTone: Record<string, string> = { won: "text-signal-400", lost: "text-warn-400", push: "text-mist-400", void: "text-mist-500", pending: "text-mist-500" };

  return (
    <MarketingPage lang={lang} langHrefs={langPaths("/prova")} wide>
      <section className="text-mist-100">
        <p className="text-[11px] uppercase tracking-[0.18em] text-edge-400">{c.eyebrow}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">{c.title}</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-mist-400">{c.sub}</p>

        <div className="mt-8 rounded-xl border border-ink-800 bg-ink-900/50 p-5">
          <h2 className="text-[14px] font-semibold text-white">{c.methodTitle}</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-mist-400">{c.methodBody}</p>
          {!publish && <p className="mt-2 text-[13.5px] leading-relaxed text-mist-300" data-testid="proof-method">{c.method.replace("{n}", String(proofMinDecided()))}</p>}
        </div>

        <ClvBlock lang={lang} />

        {publish && <><div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-ink-800 bg-ink-800 sm:grid-cols-5" data-testid="proof-stats">
          {[[c.generated, s.generated], [c.settled, s.settled], [c.hit, s.settled ? pct(s.hitRate) : "—"], [c.roi, s.settled ? `${s.roi >= 0 ? "+" : ""}${pct(s.roi)}` : "—"], [c.pending, s.pending]].map(([k, v], i) => (
            <div key={i} className="bg-ink-900 px-4 py-4"><div className="text-[10px] uppercase tracking-wider text-mist-500">{k}</div><div className={"nums mt-1 text-2xl font-semibold " + (i === 3 ? roiTone(s.roi) : "")}>{v}</div></div>
          ))}
        </div>
        {s.settled > 0 && s.settled < 30 && <p className="mt-3 text-[12px] text-mist-500">{c.small}</p>}

        <div className="mt-8"><EquityChart rows={toRows(visible, (e) => ticketSlug(e.id))} lang={lang} /></div>
        </>}

        {publish && s.settled > 0 && (
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[[c.byMarket, s.byMarket], [c.bySport, s.bySport], [c.byBand, s.byBand]].map(([title, rows]) => (
              <div key={String(title)} className="rounded-xl border border-ink-800 bg-ink-900/60 p-4">
                <p className="text-[11px] uppercase tracking-wider text-mist-500">{String(title)}</p>
                <ul className="mt-2 space-y-1.5 text-[13px]">
                  {(rows as { key: string; settled: number; won: number; roi: number }[]).slice(0, 8).map((r) => (
                    <li key={r.key} className="flex items-center justify-between"><span className="text-mist-300">{r.key}</span><span className="nums text-mist-400">{r.won}/{r.settled} · <span className={roiTone(r.roi)}>{r.roi >= 0 ? "+" : ""}{pct(r.roi)}</span></span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <h2 className="mt-12 text-xl font-semibold">{c.recent}</h2>
        {recent.length === 0 ? <p className="mt-3 text-[14px] text-mist-500">{c.none}</p> : (
          <ul className="mt-4 divide-y divide-ink-800 rounded-xl border border-ink-800" data-testid="proof-list">
            {recent.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
                <span className={"w-16 font-semibold " + outcomeTone[e.outcome]}>{outcomeLabel[e.outcome]}</span>
                <span className="nums w-16 text-mist-300">{formatDecimal(e.combinedDecimal)}</span>
                <Link href={{ pathname: `/p/${ticketSlug(e.id)}`, query: { lang } }} className="min-w-0 flex-1 truncate text-mist-100 hover:underline">{scrubText(e.title, lang)}</Link>
                <span className="text-mist-500">{scrubText(e.matchup, lang)} · {e.legs.length} {c.legs}</span>
                <span className="text-mist-500">{formatDate(e.settledAt ?? e.createdAt, lang, { year: true })}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link href={`/signup?lang=${lang}`} className="inline-block rounded-lg bg-edge-400 px-5 py-2.5 text-[14px] font-semibold text-ink-950 hover:bg-edge-500">{c.cta}</Link>
          <Link href={{ pathname: "/prova", query: withAlternatives ? { lang } : { lang, alts: "1" } }} className="text-[13px] text-mist-400 underline-offset-4 hover:text-mist-100 hover:underline" data-testid="alts-toggle">{withAlternatives ? c.mainOnly : c.withAlts}</Link>
          <a href={`/api/public/ledger?lang=${lang}`} className="text-[13px] text-mist-400 underline-offset-4 hover:text-mist-100 hover:underline" data-testid="csv-link">{c.csv}</a>
        </div>
      </section>
    </MarketingPage>
  );
}
