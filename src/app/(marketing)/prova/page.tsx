import Link from "next/link";
import type { Metadata } from "next";
import { MarketingPage } from "@/components/MarketingShell";
import { langFrom, langPaths, pageMetadata, type SearchProps } from "@/lib/seo";
import { formatDate, formatPercent } from "@/lib/format";
import { KPI, LinkButton, Notice, Panel, PrintButton, Table, Td, Th, Tr } from "@/components/ui";
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
  const pct = (n: number, signed = false) => formatPercent(n, lang, { signed });
  const roiTone = (r: number) => (r > 0 ? "text-pos" : r < 0 ? "text-neg" : "text-fg-muted");
  const outcomeLabel: Record<string, string> = { won: c.won, lost: c.lost, push: c.push, void: c.void, pending: c.pend };
  const publish = proofPublishable(s);
  const outcomeTone: Record<string, string> = { won: "text-pos", lost: "text-neg", push: "text-fg-muted", void: "text-fg-dim", pending: "text-fg-dim" };
  const rowTone = (o: string): "pos" | "neg" | undefined => (o === "won" ? "pos" : o === "lost" ? "neg" : undefined);

  return (
    <MarketingPage lang={lang} langHrefs={langPaths("/prova")} wide>
      <section className="text-fg">
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
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[[c.byMarket, s.byMarket], [c.bySport, s.bySport], [c.byBand, s.byBand]].map(([title, rows]) => (
              <div key={String(title)} className="border border-line bg-surface-1 p-4">
                <p className="text-label u-label text-fg-dim">{String(title)}</p>
                <ul className="mt-3 flex flex-col text-sm">
                  {(rows as { key: string; settled: number; won: number; roi: number }[]).slice(0, 8).map((r) => (
                    <li key={r.key} className="flex items-baseline justify-between gap-3 py-1.5 u-rule last:shadow-none"><span className="truncate text-fg-muted">{r.key}</span><span className="nums shrink-0 text-fg-muted">{r.won}/{r.settled} · <span className={roiTone(r.roi)}>{pct(r.roi, true)}</span></span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
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
                    <Td numeric label={lang === "pt" ? "Odd" : "Odds"} className="text-fg-muted">{formatDecimal(e.combinedDecimal)}</Td>
                    <Td label={lang === "pt" ? "Bilhete" : "Ticket"} className="min-w-0">
                      <Link href={{ pathname: `/p/${ticketSlug(e.id)}`, query: { lang } }} className="text-fg underline decoration-line-control underline-offset-2 hover:decoration-fg">{scrubText(e.title, lang)}</Link>
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
