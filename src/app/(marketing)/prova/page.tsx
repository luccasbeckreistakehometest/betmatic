import Link from "next/link";
import type { Metadata } from "next";
import { MarketingPage } from "@/components/MarketingShell";
import { langFrom, langPaths, pageMetadata, type SearchProps } from "@/lib/seo";
import { formatDate, formatPercent, formatNumber } from "@/lib/format";
import { KPI, LinkButton, Notice, Panel, PrintButton, PrintHeader, Table, Td, Th, Tr } from "@/components/ui";
import { readLedger } from "@/lib/ledger/store";
import { liveRecord } from "@/lib/ledger/live-record";
import { mainTickets, proofMinDecided, proofPublishable, proofStats, publicTickets, recentTickets, ticketSlug, brasiliaDay } from "@/lib/ledger/proof";
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
    won: "ganhou", lost: "perdeu", push: "push", void: "anulado", pend: "pendente", cta: "Ver os bilhetes de hoje", csv: "Baixar tudo em CSV", legs: "pernas", small: "Amostra pequena: menos de 30 bilhetes decididos ainda não diz nada sobre o longo prazo.", unit: "u", method: "Os números agregados (acerto, ROI, curva) aparecem quando houver pelo menos {n} bilhetes decididos. Até lá, a lista abaixo mostra cada bilhete e o seu resultado, sem filtro.", withAlts: "Incluir as alternativas", mainOnly: "Só os bilhetes principais",
    liveTitle: "Leituras ao vivo", liveBody: "Bilhete montado com o jogo em andamento, em cima do que já tinha acontecido em quadra. É liquidado contra o placar como qualquer outro e entra no histórico e no balanço acima, marcado como ao vivo. O preço é o da tabela de antes do jogo — a casa já tinha mexido nele —, então o retorno é de referência e aparece com esse nome.", liveDecided: "decididas", liveHit: "acerto", liveLegs: "pernas certas", liveRef: "retorno de referência", liveModelled: "chance média estimada", livePending: "em jogo ou aguardando", liveByQuarter: "Por quarto da leitura:", balanceTitle: "Balanço", balanceSub: "Uma unidade em cada bilhete decidido — pré-jogo e ao vivo, todos. O dia é o de Brasília.", overall: "Geral", today: "Hoje", dayCol: "Dia", ticketsCol: "Bilhetes", hitsCol: "Acertos", stakedCol: "Apostado", returnedCol: "Retorno", roiCol: "ROI", liveCol: "Ao vivo", noToday: "Nenhum bilhete decidido hoje ainda.", byScope: "Por origem", scopePregame: "Pré-jogo", scopeLive: "Ao vivo", scopeLiveNote: "Ao vivo mostra acerto, não retorno: o preço registrado no bilhete é o da tabela de antes do jogo.", liveTag: "ao vivo", methodTitle: "Como medimos", methodBody: "Todo bilhete é salvo no momento em que é gerado, com as odds e a chance estimada, e fica visível para todo mundo assim que a bola rola. Quando o jogo termina, cada perna é conferida contra o placar e as estatísticas oficiais: se não dá para conferir com certeza, a perna é anulada — nunca chutada. O ROI considera 1 unidade apostada em cada bilhete decidido." },
  en: { eyebrow: "Public track record", title: "Every ticket. None hidden.", sub: "Every ticket Betmatic generates is logged the moment it is born, shows up here once its game kicks off, and is graded automatically against the real score. No curation, no edits after the fact. If it ever looks bad, it looks bad here too.",
    generated: "generated", settled: "settled", hit: "hit rate", roi: "ROI at 1 unit", pending: "awaiting kickoff", byMarket: "By market", bySport: "By sport", byBand: "By odds band", recent: "Latest tickets", none: "No settled ticket yet. The first one appears once a game with a ticket ends.",
    won: "won", lost: "lost", push: "push", void: "void", pend: "pending", cta: "See today's tickets", csv: "Download everything as CSV", legs: "legs", small: "Small sample: fewer than 30 decided tickets says nothing about the long run.", unit: "u", method: "Aggregate numbers (hit rate, ROI, curve) appear once at least {n} tickets are decided. Until then, the list below shows every ticket and its result, unfiltered.", withAlts: "Include the alternatives", mainOnly: "Main tickets only",
    liveTitle: "Live reads", liveBody: "A ticket built while the game was in play, on top of what had already happened on the floor. It is graded against the score like any other and counts in the record and the balance above, tagged as live. Its price is the pre-game board's — the book had already moved it — so the return is a reference and is named that way.", liveDecided: "decided", liveHit: "hit rate", liveLegs: "legs landed", liveRef: "reference return", liveModelled: "average modelled chance", livePending: "in play or awaiting", liveByQuarter: "By the quarter of the read:", balanceTitle: "Balance", balanceSub: "One unit on every decided ticket — pre-game and live, all of them. Days are Brasília days.", overall: "Overall", today: "Today", dayCol: "Day", ticketsCol: "Tickets", hitsCol: "Hits", stakedCol: "Staked", returnedCol: "Returned", roiCol: "ROI", liveCol: "Live", noToday: "No ticket decided today yet.", byScope: "By origin", scopePregame: "Pre-game", scopeLive: "Live", scopeLiveNote: "Live shows its hit rate, not a return: the price recorded on the ticket is the pre-game board\u2019s.", liveTag: "live", methodTitle: "How we measure", methodBody: "Every ticket is saved the moment it is generated, with its odds and modelled probability, and becomes visible to everyone at kickoff. When the game ends, each leg is checked against the official score and stats: if it cannot be graded with certainty, the leg is voided — never guessed. ROI assumes 1 unit staked on every decided ticket." },
};

/** Fewer decided live reads than this and the panel says nothing worth reading. */
const LIVE_RECORD_MIN = 5;
/** Reads are taken at every quarter break; a read with no recorded quarter predates that. */
const quarterLabel = (period: number, lang: "pt" | "en") =>
  period <= 0 ? (lang === "pt" ? "sem quarto" : "no quarter") : period <= 4 ? (lang === "pt" ? `${period}º quarto` : `Q${period}`) : (lang === "pt" ? "prorrogação" : "overtime");

export default async function ProofPage({ searchParams }: SearchProps) {
  const q = await searchParams;
  const lang = normaliseLang(typeof q.lang === "string" ? q.lang : undefined);
  const c = C[lang];
  const withAlternatives = q.alts === "1";
  const entries = mainTickets(readLedger(), withAlternatives);
  const s = proofStats(entries);
  // The live reads keep their own count, hit rate only, and appear once a handful have been decided.
  const live = liveRecord();
  const showLive = live.decided >= LIVE_RECORD_MIN;
  // Counts cover everything; a ticket's content appears only once its game has started.
  const visible = publicTickets(entries);
  const recent = recentTickets(visible, 40);
  const pct = (n: number, signed = false) => formatPercent(n, lang, { signed });
  const roiTone = (r: number) => (r > 0 ? "text-pos" : r < 0 ? "text-neg" : "text-fg-muted");
  const outcomeLabel: Record<string, string> = { won: c.won, lost: c.lost, push: c.push, void: c.void, pending: c.pend };
  const publish = proofPublishable(s);
  const outcomeTone: Record<string, string> = { won: "text-pos", lost: "text-neg", push: "text-fg-muted", void: "text-fg-dim", pending: "text-fg-dim" };
  const rowTone = (o: string): "pos" | "neg" | undefined => (o === "won" ? "pos" : o === "lost" ? "neg" : undefined);

  return (
    <MarketingPage lang={lang} langHrefs={langPaths("/prova")} wide>
      <section className="text-fg">
        <PrintHeader subject={c.title} lang={lang} />
        <p className="text-label u-label text-fg-dim">{c.eyebrow}</p>
        <h1 className="u-display mt-3 text-display">{c.title}</h1>
        <p className="mt-5 max-w-measure text-body text-fg-muted">{c.sub}</p>

        <Panel title={c.methodTitle} className="mt-10">
          <p className="max-w-measure text-sm leading-relaxed text-fg-muted">{c.methodBody}</p>
          {!publish && <p className="mt-2 max-w-measure text-sm leading-relaxed text-fg-muted" data-testid="proof-method">{c.method.replace("{n}", String(proofMinDecided()))}</p>}
        </Panel>

        <ClvBlock lang={lang} />

        {publish && <><div className="mt-10 grid grid-cols-2 gap-x-8 gap-y-5 border-y border-line py-5 sm:grid-cols-5" data-testid="proof-stats">
          <KPI label={c.generated} value={String(s.generated)} />
          <KPI label={c.settled} value={String(s.settled)} />
          <KPI label={c.hit} value={s.settled ? pct(s.hitRate) : "—"} />
          <KPI label={c.roi} value={s.settled ? pct(s.roi, true) : "—"} tone={s.roi > 0 ? "pos" : s.roi < 0 ? "neg" : undefined} />
          <KPI label={c.pending} value={String(s.pending)} />
        </div>
        {s.settled > 0 && s.settled < 30 && <div className="mt-4"><Notice>{c.small}</Notice></div>}

        <EquityChart className="mt-8" rows={toRows(visible, (e) => ticketSlug(e.id))} lang={lang} />
        </>}

        {publish && s.settled > 0 && (
          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {/* The live row prints its HIT RATE, never a return: the price on an in-play ticket is the
                pre-game board (leg_prices records it as `no_live_price`), so a return computed from it
                is a number nobody could have collected. The reference return keeps its own name, in
                the live section above, where the sentence explaining it lives. */}
            {[[c.byMarket, s.byMarket, false], [c.bySport, s.bySport, false], [c.byBand, s.byBand, false], [c.byScope, s.byScope.map((r) => ({ ...r, key: r.key === "live" ? c.scopeLive : c.scopePregame, reference: r.key === "live" })), true]].map(([title, rows, scope]) => (
              <div key={String(title)} className="border border-line bg-surface-1 p-4">
                <p className="text-label u-label text-fg-dim">{String(title)}</p>
                <ul className="mt-3 flex flex-col text-sm">
                  {(rows as { key: string; settled: number; won: number; roi: number; reference?: boolean }[]).slice(0, 8).map((r) => (
                    <li key={r.key} className="flex items-baseline justify-between gap-3 py-1.5 u-rule last:shadow-none">
                      <span className="truncate text-fg-muted">{r.key}</span>
                      <span className="nums shrink-0 text-fg-muted">
                        {r.won}/{r.settled} ·{" "}
                        {r.reference
                          ? <span className="text-fg-muted">{pct(r.settled ? r.won / r.settled : 0)} <span className="font-sans text-tiny text-fg-dim">{c.liveHit}</span></span>
                          : <span className={roiTone(r.roi)}>{pct(r.roi, true)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                {scope ? <p className="mt-2 text-tiny text-fg-dim">{c.scopeLiveNote}</p> : null}
              </div>
            ))}
          </div>
        )}

        {publish && s.settled > 0 && (() => {
          const today = brasiliaDay(new Date().toISOString());
          const todayRow = s.byDay.find((d) => d.day === today);
          const line = (label: string, d: { settled: number; won: number; unitsStaked: number; unitsReturned: number; roi: number; live: { settled: number; won: number } } | undefined, key: string) => (
            <Tr key={key} tone={d && d.roi > 0 ? "pos" : d && d.roi < 0 ? "neg" : undefined}>
              <Td label={c.dayCol} className="font-medium text-fg">{label}</Td>
              <Td numeric label={c.ticketsCol} className="text-fg-muted">{d ? d.settled : "—"}</Td>
              <Td numeric label={c.hitsCol} className="text-fg-muted">{d ? `${d.won}/${d.settled}` : "—"}</Td>
              <Td numeric label={c.stakedCol} className="text-fg-muted">{d ? `${d.unitsStaked}${c.unit}` : "—"}</Td>
              <Td numeric label={c.returnedCol} className="text-fg">{d ? `${formatNumber(d.unitsReturned, lang, { digits: 2 })}${c.unit}` : "—"}</Td>
              <Td numeric label={c.roiCol} className={d ? roiTone(d.roi) : "text-fg-dim"}>{d && d.settled ? pct(d.roi, true) : "—"}</Td>
              <Td numeric label={c.liveCol} className="text-fg-dim">{d && d.live.settled ? `${d.live.won}/${d.live.settled}` : "—"}</Td>
            </Tr>
          );
          return (
            <Panel title={c.balanceTitle} className="mt-10" data-testid="proof-balance">
              <p className="max-w-measure text-sm leading-relaxed text-fg-muted">{c.balanceSub}</p>
              <div className="mt-4 border border-line bg-surface-1" data-density="compact">
                <Table caption={c.balanceTitle}>
                  <thead>
                    <tr>
                      <Th>{c.dayCol}</Th><Th numeric>{c.ticketsCol}</Th><Th numeric>{c.hitsCol}</Th><Th numeric>{c.stakedCol}</Th><Th numeric>{c.returnedCol}</Th><Th numeric>{c.roiCol}</Th><Th numeric>{c.liveCol}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {line(c.overall, { settled: s.won + s.lost, won: s.won, unitsStaked: s.unitsStaked, unitsReturned: s.unitsReturned, roi: s.roi, live: { settled: s.byScope.find((x) => x.key === "live")?.settled ?? 0, won: s.byScope.find((x) => x.key === "live")?.won ?? 0 } }, "overall")}
                    {line(c.today, todayRow, "today")}
                    {s.byDay.filter((d) => d.day !== today).slice(0, 14).map((d) => line(formatDate(`${d.day}T12:00:00-03:00`, lang, { year: true }), d, d.day))}
                  </tbody>
                </Table>
              </div>
              {!todayRow && <p className="mt-2 text-label text-fg-dim">{c.noToday}</p>}
            </Panel>
          );
        })()}

        {showLive && (
          <Panel title={c.liveTitle} className="mt-10" data-testid="proof-live">
            <p className="max-w-measure text-sm leading-relaxed text-fg-muted">{c.liveBody}</p>
            <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-line pt-5 sm:grid-cols-5">
              <KPI label={c.liveDecided} value={String(live.decided)} />
              <KPI label={c.liveHit} value={pct(live.hitRate)} tone={live.hitRate >= live.modelledAverage ? "pos" : undefined} />
              <KPI label={c.liveLegs} value={`${live.legsWon}/${live.legs}`} />
              <KPI label={c.liveModelled} value={pct(live.modelledAverage)} />
              <KPI label={c.liveRef} value={`${formatDecimal(live.referenceReturn, lang)}${c.unit} / ${live.decided}${c.unit}`} />
            </div>
            {live.periods.length > 0 && (
              <p className="mt-3 text-label text-fg-dim" data-testid="proof-live-periods">
                {c.liveByQuarter} {live.periods.map((p) => `${quarterLabel(p.period, lang)} ${p.won}/${p.tickets}`).join(" · ")}
              </p>
            )}
            {live.pending > 0 && <p className="mt-3 text-label text-fg-dim">{live.pending} {c.livePending}</p>}
          </Panel>
        )}

        <h2 className="u-title mt-14 text-lead text-fg">{c.recent}</h2>
        {recent.length === 0 ? <p className="mt-3 text-base text-fg-dim">{c.none}</p> : (
          <div className="mt-4 border border-line bg-surface-1" data-testid="proof-list" data-density="default">
            <Table caption={c.recent}>
              <thead>
                <tr>
                  <Th className="w-24">{lang === "pt" ? "Resultado" : "Result"}</Th>
                  <Th numeric className="w-20">{lang === "pt" ? "Odd" : "Odds"}</Th>
                  <Th>{lang === "pt" ? "Bilhete" : "Ticket"}</Th>
                  <Th>{lang === "pt" ? "Jogo" : "Game"}</Th>
                  <Th numeric className="w-28">{lang === "pt" ? "Data" : "Date"}</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((e) => (
                  <Tr key={e.id} tone={rowTone(e.outcome)}>
                    <Td label={lang === "pt" ? "Resultado" : "Result"} className={"font-medium " + outcomeTone[e.outcome]}>{outcomeLabel[e.outcome]}</Td>
                    <Td numeric label={lang === "pt" ? "Odd" : "Odds"} className="text-fg-muted">{formatDecimal(e.combinedDecimal, lang)}</Td>
                    <Td label={lang === "pt" ? "Bilhete" : "Ticket"} className="min-w-0">
                      <Link href={{ pathname: `/p/${ticketSlug(e.id)}`, query: { lang } }} className="text-fg underline decoration-line-control underline-offset-2 hover:decoration-fg">{scrubText(e.title, lang)}</Link>{e.scope === "live" && <span className="ml-2 rounded-control bg-surface-3 px-1.5 py-0.5 text-micro u-label text-fg-dim" data-testid="proof-live-tag">{c.liveTag}{e.period ? ` · ${quarterLabel(e.period, lang)}` : ""}</span>}
                    </Td>
                    <Td label={lang === "pt" ? "Jogo" : "Game"} className="text-fg-dim">{scrubText(e.matchup, lang)} · {e.legs.length} {c.legs}</Td>
                    <Td numeric label={lang === "pt" ? "Data" : "Date"} className="whitespace-nowrap text-fg-dim">{formatDate(e.settledAt ?? e.createdAt, lang, { year: true })}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <LinkButton variant="primary" href={`/signup?lang=${lang}`} className="h-10 px-5 text-base print-hide">{c.cta}</LinkButton>
          <PrintButton label={lang === "pt" ? "Imprimir" : "Print"} />
          <Link href={{ pathname: "/prova", query: withAlternatives ? { lang } : { lang, alts: "1" } }} className="text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline" data-testid="alts-toggle">{withAlternatives ? c.mainOnly : c.withAlts}</Link>
          <a href={`/api/public/ledger?lang=${lang}`} className="text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline" data-testid="csv-link">{c.csv}</a>
        </div>
      </section>
    </MarketingPage>
  );
}
