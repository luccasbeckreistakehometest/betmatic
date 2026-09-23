import Link from "next/link";
import type { Metadata } from "next";
import { MarketingPage } from "@/components/MarketingShell";
import { langFrom, langPaths, pageMetadata, type SearchProps } from "@/lib/seo";
import { formatDate, formatPercent, formatNumber } from "@/lib/format";
import { KPI, LinkButton, Notice, Panel, PrintButton, PrintHeader, Table, Td, Th, Tr } from "@/components/ui";
import { readLedger } from "@/lib/ledger/store";
import { liveRecord } from "@/lib/ledger/live-record";
import { mainTickets, proofMinDecided, proofPublishable, proofStats, publicTickets, recentTickets, ticketSlug, brasiliaDay } from "@/lib/ledger/proof";
import { liveCalibrationMinLegs } from "@/lib/ledger/live-calibration";
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
    won: "ganhou", lost: "perdeu", push: "push", void: "anulado", pend: "pendente", cta: "Ver os bilhetes de hoje", csv: "Baixar tudo em CSV", legs: "linhas", small: "Amostra pequena: menos de 30 bilhetes decididos ainda não diz nada sobre o longo prazo.", unit: "u", method: "Os números agregados (acerto, ROI, curva) aparecem quando houver pelo menos {n} bilhetes decididos. Até lá, a lista abaixo mostra cada bilhete e o seu resultado, sem filtro.", withAlts: "Incluir as alternativas", mainOnly: "Só os bilhetes principais",
    liveTitle: "Leituras ao vivo", liveBody: "Bilhete montado com o jogo em andamento, em cima do que já tinha acontecido em quadra. É liquidado contra o placar como qualquer outro. O preço que temos é o da tabela de antes do jogo, e no 3º quarto ele já não existe: por isso aqui não tem retorno nenhum, tem a chance que a leitura deu ao lado do que aconteceu.",
    liveDecided: "Leituras decididas", liveWon: "Acertaram", liveHit: "Acerto", liveModelled: "Chance média que demos", liveExpected: "Acertos esperados", liveObserved: "Acertos observados", liveRange: "Faixa esperada (95%)", liveGap: "Desvio", liveVerdict: "Veredito",
    liveHeadline: "{decided} leituras decididas, {won} acertaram ({hit}). Prometemos {predicted} e entregamos {hit}: {gap} acertos {direction} do esperado.",
    liveBelow: "abaixo", liveAbove: "acima", liveInside: "dentro",
    liveVerdictBelow: "abaixo do esperado", liveVerdictInside: "dentro do esperado", liveVerdictAbove: "acima do esperado",
    liveLegLine: "Nas linhas do bilhete: {won} de {n} acertaram, esperávamos {expected}. Desvio {gap} pontos.",
    liveSkill: "Ganho sobre carimbar a média (Brier skill)", liveCoverage: "{n} linhas na conta, {out} fora por falta de chance calculada · {games} jogos",
    liveBuckets: "Quando dissemos X%, aconteceu Y%", liveBucketBand: "Chance que demos", liveBucketN: "Linhas", liveBucketObs: "Aconteceu", liveBucketRange: "Faixa 95%", liveBucketGap: "Desvio",
    liveQuarters: "Por quarto", liveQuarterCol: "Quarto", liveQuarterN: "Linhas", liveQuarterHit: "Acerto", liveQuarterExp: "Esperado", liveQuarterGap: "Desvio",
    liveFoot: "Não publicamos retorno das leituras ao vivo. O preço que temos é o da tabela de antes do jogo, e no 3º quarto ele já não existe. Publicamos só o que dá para conferir: com que frequência a leitura acerta, contra a chance que ela mesma prometeu.",
    liveSmall: "Amostra pequena: abaixo de {n} linhas decididas não publicamos percentual, só a contagem e o método.",
    livePending: "em jogo ou aguardando",
    balanceTitle: "Balanço (pré-jogo)", balanceSub: "Uma unidade em cada bilhete de pré-jogo decidido. Leitura ao vivo não entra: o preço dela não é coletável, e o acerto dela fica no bloco ao lado. O dia é o de Brasília.", overall: "Geral", today: "Hoje", dayCol: "Dia", ticketsCol: "Bilhetes", hitsCol: "Acertos", stakedCol: "Apostado", returnedCol: "Retorno", roiCol: "ROI", liveCol: "Ao vivo (acerto · desvio)", noToday: "Nenhum bilhete decidido hoje ainda.", byScope: "Por origem", scopePregame: "Pré-jogo", scopeLive: "Ao vivo", liveTag: "ao vivo", methodTitle: "Como medimos", methodBody: "Todo bilhete é salvo no momento em que é gerado, com as odds e a chance estimada, e fica visível para todo mundo assim que a bola rola. Quando o jogo termina, cada linha é conferida contra o placar e as estatísticas oficiais: se não dá para conferir com certeza, a linha é anulada — nunca chutada. O ROI considera 1 unidade apostada em cada bilhete de pré-jogo decidido; leitura ao vivo não tem ROI." },
  en: { eyebrow: "Public track record", title: "Every ticket. None hidden.", sub: "Every ticket Betmatic generates is logged the moment it is born, shows up here once its game kicks off, and is graded automatically against the real score. No curation, no edits after the fact. If it ever looks bad, it looks bad here too.",
    generated: "generated", settled: "settled", hit: "hit rate", roi: "ROI at 1 unit", pending: "awaiting kickoff", byMarket: "By market", bySport: "By sport", byBand: "By odds band", recent: "Latest tickets", none: "No settled ticket yet. The first one appears once a game with a ticket ends.",
    won: "won", lost: "lost", push: "push", void: "void", pend: "pending", cta: "See today's tickets", csv: "Download everything as CSV", legs: "legs", small: "Small sample: fewer than 30 decided tickets says nothing about the long run.", unit: "u", method: "Aggregate numbers (hit rate, ROI, curve) appear once at least {n} tickets are decided. Until then, the list below shows every ticket and its result, unfiltered.", withAlts: "Include the alternatives", mainOnly: "Main tickets only",
    liveTitle: "Live reads", liveBody: "A ticket built while the game was in play, on top of what had already happened on the floor. It is graded against the score like any other. The only price we have is the pre-game board's, and by the third quarter it no longer exists: so there is no return here, there is the chance the read gave beside what happened.",
    liveDecided: "Reads decided", liveWon: "Landed", liveHit: "Hit rate", liveModelled: "Average chance we gave", liveExpected: "Expected wins", liveObserved: "Observed wins", liveRange: "Expected range (95%)", liveGap: "Gap", liveVerdict: "Verdict",
    liveHeadline: "{decided} reads decided, {won} landed ({hit}). We promised {predicted} and delivered {hit}: {gap} wins {direction} expectation.",
    liveBelow: "below", liveAbove: "above", liveInside: "inside",
    liveVerdictBelow: "below expectation", liveVerdictInside: "inside expectation", liveVerdictAbove: "above expectation",
    liveLegLine: "On the legs: {won} of {n} landed, we expected {expected}. Gap {gap} points.",
    liveSkill: "Gain over stamping the average (Brier skill)", liveCoverage: "{n} legs counted, {out} left out for want of a computed chance · {games} games",
    liveBuckets: "When we said X%, Y% happened", liveBucketBand: "Chance we gave", liveBucketN: "Legs", liveBucketObs: "Happened", liveBucketRange: "95% range", liveBucketGap: "Gap",
    liveQuarters: "By quarter", liveQuarterCol: "Quarter", liveQuarterN: "Legs", liveQuarterHit: "Hit rate", liveQuarterExp: "Expected", liveQuarterGap: "Gap",
    liveFoot: "We publish no return for the live reads. The only price we have is the pre-game board's, and by the third quarter it no longer exists. We publish what can be checked: how often a read lands, against the chance it gave itself.",
    liveSmall: "Small sample: below {n} decided legs we publish no percentage, only the count and the method.",
    livePending: "in play or awaiting",
    balanceTitle: "Balance (pre-game)", balanceSub: "One unit on every decided pre-game ticket. Live reads are out: their price is not collectable, and their hit rate is in the block beside this one. Days are Brasília days.", overall: "Overall", today: "Today", dayCol: "Day", ticketsCol: "Tickets", hitsCol: "Hits", stakedCol: "Staked", returnedCol: "Returned", roiCol: "ROI", liveCol: "Live (hit · gap)", noToday: "No ticket decided today yet.", byScope: "By origin", scopePregame: "Pre-game", scopeLive: "Live", liveTag: "live", methodTitle: "How we measure", methodBody: "Every ticket is saved the moment it is generated, with its odds and modelled probability, and becomes visible to everyone at kickoff. When the game ends, each leg is checked against the official score and stats: if it cannot be graded with certainty, the leg is voided — never guessed. ROI assumes 1 unit staked on every decided pre-game ticket; a live read has no ROI." },
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
  const cal = s.liveCalibration;
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
            {[[c.byMarket, s.byMarket], [c.bySport, s.bySport], [c.byBand, s.byBand], [c.byScope, s.byScope.map((r) => ({ ...r, key: r.key === "live" ? c.scopeLive : c.scopePregame }))]].map(([title, rows]) => (
              <div key={String(title)} className="border border-line bg-surface-1 p-4">
                <p className="text-label u-label text-fg-dim">{String(title)}</p>
                <ul className="mt-3 flex flex-col text-sm">
                  {/* A live read has counts and no ROI: its price is the pre-game board, which nobody was still offering. */}
                  {(rows as { key: string; settled: number; won: number; roi?: number }[]).slice(0, 8).map((r) => (
                    <li key={r.key} className="flex items-baseline justify-between gap-3 py-1.5 u-rule last:shadow-none"><span className="truncate text-fg-muted">{r.key}</span><span className="nums shrink-0 text-fg-muted">{r.won}/{r.settled}{r.roi === undefined ? "" : <> · <span className={roiTone(r.roi)}>{pct(r.roi, true)}</span></>}</span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {publish && s.settled > 0 && (() => {
          const today = brasiliaDay(new Date().toISOString());
          const todayRow = s.byDay.find((d) => d.day === today);
          const line = (label: string, d: { settled: number; won: number; unitsStaked: number; unitsReturned: number; roi: number; live: { settled: number; won: number; gapPoints: number } } | undefined, key: string) => (
            <Tr key={key} tone={d && d.roi > 0 ? "pos" : d && d.roi < 0 ? "neg" : undefined}>
              <Td label={c.dayCol} className="font-medium text-fg">{label}</Td>
              <Td numeric label={c.ticketsCol} className="text-fg-muted">{d ? d.settled : "—"}</Td>
              <Td numeric label={c.hitsCol} className="text-fg-muted">{d ? `${d.won}/${d.settled}` : "—"}</Td>
              <Td numeric label={c.stakedCol} className="text-fg-muted">{d ? `${d.unitsStaked}${c.unit}` : "—"}</Td>
              <Td numeric label={c.returnedCol} className="text-fg">{d ? `${formatNumber(d.unitsReturned, lang, { digits: 2 })}${c.unit}` : "—"}</Td>
              <Td numeric label={c.roiCol} className={d ? roiTone(d.roi) : "text-fg-dim"}>{d && d.settled ? pct(d.roi, true) : "—"}</Td>
              <Td numeric label={c.liveCol} className="text-fg-dim">{d && d.live.settled ? `${d.live.won}/${d.live.settled} · ${formatNumber(d.live.gapPoints, lang, { digits: 1, signed: true })}p` : "—"}</Td>
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
                    {line(c.overall, { settled: s.won + s.lost, won: s.won, unitsStaked: s.unitsStaked, unitsReturned: s.unitsReturned, roi: s.roi, live: { settled: cal.tickets.n, won: cal.tickets.won, gapPoints: cal.tickets.gapPoints } }, "overall")}
                    {line(c.today, todayRow, "today")}
                    {s.byDay.filter((d) => d.day !== today).slice(0, 14).map((d) => line(formatDate(`${d.day}T12:00:00-03:00`, lang, { year: true }), d, d.day))}
                  </tbody>
                </Table>
              </div>
              {!todayRow && <p className="mt-2 text-label text-fg-dim">{c.noToday}</p>}
            </Panel>
          );
        })()}

        {showLive && (() => {
          const t = cal.tickets;
          const legs = cal.legs;
          const verdictLabel = { abaixo: c.liveVerdictBelow, dentro: c.liveVerdictInside, acima: c.liveVerdictAbove }[t.verdict];
          const direction = t.verdict === "abaixo" ? c.liveBelow : t.verdict === "acima" ? c.liveAbove : c.liveInside;
          const headline = c.liveHeadline
            .replace("{decided}", String(t.n))
            .replace("{won}", String(t.won))
            .replaceAll("{hit}", pct(t.hitRate))
            .replace("{predicted}", pct(t.predictedAverage))
            .replace("{gap}", formatNumber(Math.abs(t.won - t.expectedWins), lang, { digits: 1 }))
            .replace("{direction}", direction);
          const gapTone = (g: number) => (g < 0 ? "text-neg" : g > 0 ? "text-pos" : "text-fg-muted");
          const points = (g: number) => `${formatNumber(g, lang, { digits: 1, signed: true })}p`;
          return (
            <Panel title={c.liveTitle} className="mt-10" data-testid="proof-live">
              <p className="max-w-measure text-sm leading-relaxed text-fg-muted">{c.liveBody}</p>
              {!cal.publishable ? (
                <>
                  <p className="mt-4 text-sm text-fg-muted" data-testid="proof-live-small">{c.liveSmall.replace("{n}", String(liveCalibrationMinLegs()))}</p>
                  <p className="mt-2 text-label text-fg-dim" data-testid="proof-live-coverage">
                    {c.liveCoverage.replace("{n}", String(cal.coverage.withComputed)).replace("{out}", String(cal.coverage.legsDecided - cal.coverage.withComputed)).replace("{games}", String(cal.coverage.games))}
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-4 max-w-measure text-lead text-fg" data-testid="proof-live-headline">{headline}</p>
                  <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-line pt-5 sm:grid-cols-4">
                    <KPI label={c.liveDecided} value={String(t.n)} />
                    <KPI label={c.liveWon} value={String(t.won)} />
                    <KPI label={c.liveHit} value={pct(t.hitRate)} />
                    <KPI label={c.liveModelled} value={pct(t.predictedAverage)} />
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-line pt-5 sm:grid-cols-5">
                    <KPI label={c.liveExpected} value={formatNumber(t.expectedWins, lang, { digits: 1 })} />
                    <KPI label={c.liveObserved} value={String(t.won)} />
                    <KPI label={c.liveRange} value={`${t.lo}–${t.hi}`} />
                    <KPI label={c.liveGap} value={points(t.gapPoints)} tone={t.gapPoints < 0 ? "neg" : t.gapPoints > 0 ? "pos" : undefined} />
                    <KPI label={c.liveVerdict} value={verdictLabel} tone={t.verdict === "abaixo" ? "neg" : t.verdict === "acima" ? "pos" : undefined} />
                  </div>
                  <p className="mt-4 max-w-measure text-sm text-fg-muted" data-testid="proof-live-legs">
                    {c.liveLegLine.replace("{won}", String(legs.won)).replace("{n}", String(legs.n)).replace("{expected}", formatNumber(legs.expectedWins, lang, { digits: 1 })).replace("{gap}", formatNumber(legs.gapPoints, lang, { digits: 1, signed: true }))}
                    {" "}
                    <span className="text-fg-dim">{c.liveSkill}: {pct(legs.skill, true)}.</span>
                  </p>
                  <p className="mt-2 text-label text-fg-dim" data-testid="proof-live-coverage">
                    {c.liveCoverage.replace("{n}", String(cal.coverage.withComputed)).replace("{out}", String(cal.coverage.legsDecided - cal.coverage.withComputed)).replace("{games}", String(cal.coverage.games))}
                  </p>

                  {cal.buckets.length > 0 && (
                    <div className="mt-6">
                      <p className="text-label u-label text-fg-dim">{c.liveBuckets}</p>
                      <div className="mt-3 border border-line bg-surface-1" data-density="compact" data-testid="proof-live-buckets">
                        <Table caption={c.liveBuckets}>
                          <thead>
                            <tr>
                              <Th>{c.liveBucketBand}</Th><Th numeric>{c.liveBucketN}</Th><Th numeric>{c.liveBucketObs}</Th><Th numeric>{c.liveBucketRange}</Th><Th numeric>{c.liveBucketGap}</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {cal.buckets.map((b) => (
                              <Tr key={`${b.from}-${b.to}`}>
                                <Td label={c.liveBucketBand} className="text-fg">{pct(b.predicted)} <span className="text-fg-dim">({pct(b.from, false)}–{pct(b.to, false)})</span></Td>
                                <Td numeric label={c.liveBucketN} className="text-fg-muted">{b.n}</Td>
                                <Td numeric label={c.liveBucketObs} className="text-fg">{pct(b.observed)}</Td>
                                <Td numeric label={c.liveBucketRange} className="text-fg-dim">{pct(b.lo)}–{pct(b.hi)}</Td>
                                <Td numeric label={c.liveBucketGap} className={gapTone(b.gap)}>{points(b.gap * 100)}</Td>
                              </Tr>
                            ))}
                          </tbody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {cal.byPeriod.length > 0 && (
                    <div className="mt-6">
                      <p className="text-label u-label text-fg-dim">{c.liveQuarters}</p>
                      <div className="mt-3 border border-line bg-surface-1" data-density="compact" data-testid="proof-live-quarters">
                        <Table caption={c.liveQuarters}>
                          <thead>
                            <tr>
                              <Th>{c.liveQuarterCol}</Th><Th numeric>{c.liveQuarterN}</Th><Th numeric>{c.liveQuarterHit}</Th><Th numeric>{c.liveQuarterExp}</Th><Th numeric>{c.liveQuarterGap}</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {cal.byPeriod.map((q) => (
                              <Tr key={q.key}>
                                <Td label={c.liveQuarterCol} className="text-fg">{quarterLabel(Number(q.key.replace("q", "")), lang)}</Td>
                                <Td numeric label={c.liveQuarterN} className="text-fg-muted">{q.n}</Td>
                                <Td numeric label={c.liveQuarterHit} className="text-fg">{pct(q.hitRate)}</Td>
                                <Td numeric label={c.liveQuarterExp} className="text-fg-muted">{formatNumber(q.expectedWins, lang, { digits: 1 })}</Td>
                                <Td numeric label={c.liveQuarterGap} className={gapTone(q.gapPoints)}>{points(q.gapPoints)}</Td>
                              </Tr>
                            ))}
                          </tbody>
                        </Table>
                      </div>
                    </div>
                  )}
                </>
              )}
              {live.pending > 0 && <p className="mt-3 text-label text-fg-dim">{live.pending} {c.livePending}</p>}
              <p className="mt-5 max-w-measure border-t border-line pt-4 text-sm leading-relaxed text-fg-muted" data-testid="proof-live-foot">{c.liveFoot}</p>
            </Panel>
          );
        })()}

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
