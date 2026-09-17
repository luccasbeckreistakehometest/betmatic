import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { readLedger } from "@/lib/ledger/store";
import { proofStats, recentTickets, ticketSlug } from "@/lib/ledger/proof";
import { scrubText } from "@/lib/server/whitelabel";
import { normaliseLang } from "@/lib/i18n";
import { formatDecimal } from "@/lib/odds";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Betmatic — Prova: todos os bilhetes, liquidados automaticamente",
  description: "Histórico público e verificável: cada bilhete gerado, graded contra o resultado real, com taxa de acerto e ROI a stake fixo. Nada curado.",
};

const C = {
  pt: { eyebrow: "Prova pública", title: "Todos os bilhetes. Nenhum escondido.", sub: "Cada bilhete que o Betmatic gera entra aqui no momento em que nasce e é liquidado sozinho contra o placar real. Sem seleção, sem editar depois. Se um dia ficar feio, vai ficar feio aqui também.",
    generated: "gerados", settled: "liquidados", hit: "acerto", roi: "ROI a 1 unidade", pending: "aguardando jogo", byMarket: "Por mercado", bySport: "Por esporte", byBand: "Por faixa de odd", recent: "Últimos bilhetes", none: "Ainda não há bilhete liquidado. O primeiro aparece assim que um jogo com bilhete terminar.",
    won: "ganhou", lost: "perdeu", push: "push", void: "anulado", pend: "pendente", cta: "Ver os bilhetes de hoje", csv: "Baixar tudo em CSV", legs: "pernas", small: "Amostra pequena: menos de 30 bilhetes decididos ainda não diz nada sobre o longo prazo.", unit: "u" },
  en: { eyebrow: "Public track record", title: "Every ticket. None hidden.", sub: "Every ticket Betmatic generates lands here the moment it is born and is graded automatically against the real score. No curation, no edits after the fact. If it ever looks bad, it looks bad here too.",
    generated: "generated", settled: "settled", hit: "hit rate", roi: "ROI at 1 unit", pending: "awaiting kickoff", byMarket: "By market", bySport: "By sport", byBand: "By odds band", recent: "Latest tickets", none: "No settled ticket yet. The first one appears once a game with a ticket ends.",
    won: "won", lost: "lost", push: "push", void: "void", pend: "pending", cta: "See today's tickets", csv: "Download everything as CSV", legs: "legs", small: "Small sample: fewer than 30 decided tickets says nothing about the long run.", unit: "u" },
};

export default async function ProofPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const lang = normaliseLang(typeof q.lang === "string" ? q.lang : undefined);
  const c = C[lang];
  const entries = readLedger();
  const s = proofStats(entries);
  const recent = recentTickets(entries, 40);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const roiTone = (r: number) => (r > 0 ? "text-signal-400" : r < 0 ? "text-warn-400" : "text-mist-300");
  const outcomeLabel: Record<string, string> = { won: c.won, lost: c.lost, push: c.push, void: c.void, pending: c.pend };
  const outcomeTone: Record<string, string> = { won: "text-signal-400", lost: "text-warn-400", push: "text-mist-400", void: "text-mist-500", pending: "text-mist-500" };

  return (
    <main className="min-h-screen bg-ink-950 text-mist-100">
      <header className="border-b border-ink-800/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4"><Logo /><Link href={{ pathname: "/", query: { lang } }} className="text-[13px] text-mist-400 hover:text-mist-100">← Betmatic</Link></div>
      </header>
      <section className="mx-auto max-w-5xl px-5 py-12">
        <p className="text-[11px] uppercase tracking-[0.18em] text-edge-400">{c.eyebrow}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">{c.title}</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-mist-400">{c.sub}</p>

        <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-ink-800 bg-ink-800 sm:grid-cols-5" data-testid="proof-stats">
          {[[c.generated, s.generated], [c.settled, s.settled], [c.hit, s.settled ? pct(s.hitRate) : "—"], [c.roi, s.settled ? `${s.roi >= 0 ? "+" : ""}${pct(s.roi)}` : "—"], [c.pending, s.pending]].map(([k, v], i) => (
            <div key={i} className="bg-ink-900 px-4 py-4"><div className="text-[10px] uppercase tracking-wider text-mist-500">{k}</div><div className={"nums mt-1 text-2xl font-semibold " + (i === 3 ? roiTone(s.roi) : "")}>{v}</div></div>
          ))}
        </div>
        {s.settled > 0 && s.settled < 30 && <p className="mt-3 text-[12px] text-mist-500">{c.small}</p>}

        {s.settled > 0 && (
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
                <span className="text-mist-600">{new Date(e.settledAt ?? e.createdAt).toLocaleDateString(lang === "pt" ? "pt-BR" : "en-US")}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link href="/signup" className="inline-block rounded-lg bg-edge-400 px-5 py-2.5 text-[14px] font-semibold text-ink-950 hover:bg-edge-500">{c.cta}</Link>
          <a href={`/api/public/ledger?lang=${lang}`} className="text-[13px] text-mist-400 underline-offset-4 hover:text-mist-100 hover:underline" data-testid="csv-link">{c.csv}</a>
        </div>
      </section>
    </main>
  );
}
