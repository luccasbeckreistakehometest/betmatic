"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useNavState } from "@/components/Controls";
import { KPI, Panel, PrintButton } from "@/components/ui";
import { PanelSkeleton } from "@/components/AppPageHead";
import { SelfExclusionLinks } from "@/components/SettingsPanel";
import { formatDate, formatMoney, formatPercent, formatTime } from "@/lib/format";
import type { WeeklyPayload } from "@/lib/discipline";
import type { Lang } from "@/lib/i18n";

interface Payload { current: WeeklyPayload; history: WeeklyPayload[]; paused: { until: string | null } | null; error?: string }

const C = {
  pt: {
    title: "Relatório da semana", sub: "Um espelho de como você apostou: onde perde, quando aumentou a aposta depois de perder e o quanto foi para bilhetes longos. Não é conselho para apostar mais — é para você decidir com calma.",
    windows: "Retorno", days: "{d} dias", bets: "apostas", roi: "retorno", staked: "apostado", noBets: "sem apostas decididas",
    clv: "Preço contra o fechamento", clvNone: "Sem pernas com fechamento nesta semana.",
    chasing: "Aumento depois de perder", chasingNone: "Você não aumentou a aposta logo depois de uma derrota nesta semana.",
    chasingItem: "{stake} apostados {m} min depois de perder {prev}", chasingLead: (n: number) => `${n === 1 ? "1 vez" : `${n} vezes`} você apostou pelo menos 1,5× o valor anterior até 3 horas depois de perder.`,
    kelly: "Tamanho das apostas", kellyNone: "Informe sua banca em Configurações para ver se os valores estão dentro de um tamanho sensato.", kellyText: (o: number, s: number) => `${o} de ${s} apostas passaram do dobro do tamanho sensato (¼ Kelly) para a sua banca.`,
    late: "Madrugada", lateText: (n: number, p: number) => `${n === 1 ? "1 aposta" : `${n} apostas`} entre meia-noite e 5h (${p}% da semana).`, lateNone: "Nenhuma aposta de madrugada.",
    long: "Bilhetes longos (20x ou mais)", longText: (n: number, p: number) => `${n === 1 ? "1 bilhete" : `${n} bilhetes`}, ${p}% do valor apostado.`, longCost: (u: string) => `Pelo modelo, o custo esperado desses bilhetes é de ${u}.`, longNone: "Nenhum bilhete longo.",
    help: "Se precisar de uma pausa", pause: "Pausar agora", past: "Semanas anteriores", pastNone: "Os relatórios salvos aparecem aqui toda segunda-feira.", empty: "Ainda não há apostas na sua banca. Salve um bilhete ou mande o print de um para o relatório começar.",
    signIn: "Entre na sua conta para ver o relatório.", period: "de {from} a {to}",
  },
  en: {
    title: "Weekly report", sub: "A mirror of how you bet: where you lose, when you raised the stake after a loss, and how much went into long shots. It is not advice to bet more — it is there so you can decide calmly.",
    windows: "Return", days: "{d} days", bets: "bets", roi: "return", staked: "staked", noBets: "no decided bets",
    clv: "Price against the close", clvNone: "No legs with a close this week.",
    chasing: "Raising after a loss", chasingNone: "You didn't raise the stake right after a loss this week.",
    chasingItem: "{stake} staked {m} min after losing {prev}", chasingLead: (n: number) => `${n === 1 ? "Once" : `${n} times`} you staked at least 1.5× the previous amount within 3 hours of losing.`,
    kelly: "Stake size", kellyNone: "Set your bankroll in Settings to see whether stakes stay within a sensible size.", kellyText: (o: number, s: number) => `${o} of ${s} bets went past twice the sensible size (¼ Kelly) for your bankroll.`,
    late: "Late night", lateText: (n: number, p: number) => `${n === 1 ? "1 bet" : `${n} bets`} between midnight and 5am (${p}% of the week).`, lateNone: "No late-night bets.",
    long: "Long shots (20x or more)", longText: (n: number, p: number) => `${n === 1 ? "1 ticket" : `${n} tickets`}, ${p}% of the money staked.`, longCost: (u: string) => `By the model, those tickets are expected to cost ${u}.`, longNone: "No long shots.",
    help: "If you need a break", pause: "Pause now", past: "Earlier weeks", pastNone: "Saved reports show up here every Monday.", empty: "No bets in your bankroll yet. Save a ticket or send a slip screenshot and the report starts.",
    signIn: "Log in to see the report.", period: "{from} to {to}",
  },
};

const money = (n: number, lang: Lang) => formatMoney(n, lang);
const pct = (x: number | null, lang: Lang) => (x === null ? "—" : formatPercent(x, lang, { signed: true }));

function Report({ p, lang }: { p: WeeklyPayload; lang: Lang }) {
  const c = C[lang];
  return (
    <div className="flex flex-col gap-3" data-testid="weekly-report">
      <p className="text-tiny text-fg-dim">{c.period.replace("{from}", formatDate(p.from, lang)).replace("{to}", formatDate(p.to, lang))} · {p.bets} {c.bets}</p>
      <div className="grid grid-cols-3 gap-x-6 gap-y-4 border-y border-line py-4">
        {p.windows.map((w) => (
          <KPI
            key={w.days}
            label={`${c.windows} · ${c.days.replace("{d}", String(w.days))}`}
            value={w.bets ? pct(w.roi, lang) : "—"}
            tone={w.roi === null ? undefined : w.roi >= 0 ? "pos" : "neg"}
            sub={w.bets ? `${w.bets} ${c.bets} · ${money(w.staked, lang)} ${c.staked}` : c.noBets}
          />
        ))}
      </div>
      <dl className="grid gap-2 text-tiny sm:grid-cols-2">
        <div className={`border-l-2 py-1.5 pl-3 ${p.chasing.length ? "border-neg" : "border-line"}`} data-testid="report-chasing">
          <dt className="text-micro u-label text-fg-dim">{c.chasing}</dt>
          <dd className={p.chasing.length ? "text-neg" : "text-fg-muted"}>{p.chasing.length ? c.chasingLead(p.chasing.length) : c.chasingNone}</dd>
          {p.chasing.slice(0, 5).map((x, i) => <dd key={i} className="nums text-tiny text-fg-dim">{formatDate(x.at, lang)} {formatTime(x.at, lang)} — {c.chasingItem.replace("{stake}", money(x.stake, lang)).replace("{m}", String(x.minutesAfterLoss)).replace("{prev}", money(x.previousStake, lang))}</dd>)}
        </div>
        <div className="border-l-2 border-line py-1.5 pl-3">
          <dt className="text-micro u-label text-fg-dim">{c.kelly}</dt>
          <dd className="text-fg-muted">{p.kelly.share === null ? c.kellyNone : c.kellyText(p.kelly.over, p.kelly.sized)}</dd>
        </div>
        <div className="border-l-2 border-line py-1.5 pl-3">
          <dt className="text-micro u-label text-fg-dim">{c.late}</dt>
          <dd className="text-fg-muted">{p.lateNight.late ? c.lateText(p.lateNight.late, Math.round((p.lateNight.share ?? 0) * 100)) : c.lateNone}</dd>
        </div>
        <div className="border-l-2 border-line py-1.5 pl-3">
          <dt className="text-micro u-label text-fg-dim">{c.long}</dt>
          <dd className="text-fg-muted">{p.longShots.count ? c.longText(p.longShots.count, Math.round((p.longShots.stakeShare ?? 0) * 100)) : c.longNone}</dd>
          {p.longShots.expectedCost !== null && p.longShots.expectedCost > 0 && <dd className="text-tiny text-fg-dim">{c.longCost(money(p.longShots.expectedCost, lang))}</dd>}
        </div>
        <div className="rounded-control border border-line p-2.5 sm:col-span-2">
          <dt className="text-micro u-label text-fg-dim">{c.clv}</dt>
          <dd className="text-fg-muted">{p.clv === null ? c.clvNone : pct(p.clv, lang)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function WeeklyReport() {
  const { lang } = useNavState();
  const c = C[lang];
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => {
    const id = setTimeout(() => {
      fetch("/api/report", { cache: "no-store" }).then(async (r) => setData(r.ok ? await r.json() : { error: "unauthenticated" } as Payload)).catch(() => {});
    }, 0);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="u-title text-lead text-fg">{c.title}</h2>
          <p className="mt-1 max-w-measure-app text-sm leading-relaxed text-fg-muted">{c.sub}</p>
        </div>
        <PrintButton label={lang === "pt" ? "Imprimir" : "Print"} />
      </div>
      {data?.error ? <p className="text-sm text-fg-muted">{c.signIn}</p> : !data ? <PanelSkeleton rows={4} /> : (
        <>
          <Panel title={c.title} lang={lang}>
            {data.current.bets === 0 && data.current.windows.every((w) => w.bets === 0) ? <p className="text-sm text-fg-dim">{c.empty}</p> : <Report p={data.current} lang={lang} />}
          </Panel>
          <section className="border-l-2 border-warn bg-warn-tint p-4" data-testid="report-help">
            <h2 className="text-sm font-semibold text-fg">{c.help}</h2>
            <SelfExclusionLinks lang={lang} />
            <Link href={{ pathname: "/app/settings", query: { lang } }} className="mt-3 inline-flex h-(--row-h) items-center rounded-control border border-warn px-3 text-sm font-medium text-warn transition-colors duration-(--dur-1) hover:bg-warn/10" data-testid="report-pause">{c.pause}</Link>
          </section>
          <Panel title={c.past} lang={lang}>
            {data.history.length ? (
              <ul className="flex flex-col gap-4">{data.history.map((p) => <li key={p.weekKey} className="border-b border-line pb-3 last:border-0"><p className="mb-1 text-tiny font-semibold text-fg">{p.weekKey}</p><Report p={p} lang={lang} /></li>)}</ul>
            ) : <p className="text-sm text-fg-dim">{c.pastNone}</p>}
          </Panel>
        </>
      )}
    </div>
  );
}
