"use client";

import { track } from "@/lib/track";
import Link from "next/link";
import { useState } from "react";
import { expectedValue, formatDecimal, impliedProbability, parlayDecimal, parlayHold, parseOdds } from "@/lib/odds";
import type { Lang } from "@/lib/i18n";
import { formatPercent } from "@/lib/format";

/**
 * Free, no-signup calculators. They exist because a bettor searching "calculadora de múltipla" is a
 * bettor deciding whether to trust a tool — and the numbers here are the same odds math the product
 * runs on every ticket.
 */
const C = {
  pt: { eyebrow: "Ferramentas grátis", title: "As contas que a casa prefere que você não faça.", sub: "Sem cadastro. Mesma matemática que o Betmatic usa em cada bilhete.",
    ev: "Valor esperado (+EV)", evHelp: "Odd que a casa oferece e a chance real que você acha que tem. Se o EV for positivo, a aposta paga mais do que o risco no longo prazo.", odds: "Odd", prob: "Sua chance real (%)", evResult: "EV por unidade apostada", implied: "chance implícita na odd", edge: "sua vantagem",
    parlay: "Múltipla e margem da casa", parlayHelp: "Coloque as odds das pernas. Mostra a odd combinada, a chance implícita e quanto de margem a casa está cobrando em cima — que cresce a cada perna.", leg: "Perna", combined: "Odd combinada", chance: "chance implícita", hold: "margem da casa nesta múltipla", holdNote: "Com odds justas a margem seria 0%. Cada perna adiciona a comissão da casa por cima da anterior.",
    conv: "Conversor de odds", convHelp: "Decimal, americana e probabilidade implícita, uma pela outra.", american: "Americana", cta: "Bilhetes com essa matemática já feita →" },
  en: { eyebrow: "Free tools", title: "The math the book would rather you didn't do.", sub: "No signup. The same odds math Betmatic runs on every ticket.",
    ev: "Expected value (+EV)", evHelp: "The price the book offers and the real chance you think you have. Positive EV means the bet pays more than its risk over time.", odds: "Odds", prob: "Your true chance (%)", evResult: "EV per unit staked", implied: "chance implied by the odds", edge: "your edge",
    parlay: "Parlay & house hold", parlayHelp: "Enter each leg's odds. Shows the combined price, the implied chance and how much margin the book takes on top — it compounds with every leg.", leg: "Leg", combined: "Combined odds", chance: "implied chance", hold: "house hold on this parlay", holdNote: "With fair odds the hold would be 0%. Each leg stacks the book's cut on the previous one.",
    conv: "Odds converter", convHelp: "Decimal, American and implied probability, from any one of them.", american: "American", cta: "Tickets with this math already done →" },
};

const Field = ({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId?: string }) => (
  <label className="block text-tiny text-fg-muted">{label}<input value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => { if (testId) track("tool_used", { tool: testId.split("-")[0] }); }} inputMode="decimal" data-testid={testId} className="mt-1 w-full inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap border border-line-control text-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-surface-2 active:bg-surface-3 disabled:cursor-not-allowed disabled:border-line disabled:text-fg-faint" /></label>
);
/** One column of a single ruled group — not a floating card. The three share a frame, a top rule
 *  and the same internal order, so the reader compares tools instead of reading three panels. */
const Card = ({ title, help, children }: { title: string; help: string; children: React.ReactNode }) => (
  <div className="flex flex-col p-(--panel-p)">
    <h2 className="u-title text-base text-fg">{title}</h2>
    <p className="mt-1.5 max-w-measure-app text-tiny leading-relaxed text-fg-dim">{help}</p>
    <div className="mt-5 flex flex-1 flex-col">{children}</div>
  </div>
);
// pt-BR numerals, like every other number in the product (§11.2).
const pct = (n: number, lang: Lang, signed = false) => formatPercent(n, lang, { signed });

export function Calculators({ lang }: { lang: Lang }) {
  const c = C[lang];
  const [evOdds, setEvOdds] = useState("2.10"); const [evProb, setEvProb] = useState("52");
  const [legs, setLegs] = useState(["1.85", "1.70", "2.20"]);
  const [convDec, setConvDec] = useState("2.50");

  const o = parseOdds(evOdds), p = Number(evProb) / 100;
  const ev = Number.isFinite(o) && p > 0 && p < 1 ? expectedValue([o], [p]) : NaN;
  const legOdds = legs.map(parseOdds).filter((d) => Number.isFinite(d) && d > 1);
  const combined = legOdds.length ? parlayDecimal(legOdds) : NaN;
  // Fair legs are approximated from the book's own two-sided prices: the standard 4.5% per side.
  const hold = legOdds.length ? parlayHold(legOdds, legOdds.map((d) => impliedProbability(d) / 1.045)) : NaN;
  const dec = parseOdds(convDec);
  const american = Number.isFinite(dec) ? (dec >= 2 ? `+${Math.round((dec - 1) * 100)}` : `${Math.round(-100 / (dec - 1))}`) : "—";

  return (
    <section className="mx-auto max-w-shell px-4 py-14 sm:px-6" data-density="comfortable">
      <p className="text-label u-label text-fg-dim">{c.eyebrow}</p>
      <h1 className="u-display mt-3 text-display text-fg">{c.title}</h1>
      <p className="mt-3 text-base text-fg-muted">{c.sub}</p>
      <div className="mt-10 grid divide-y divide-line border border-line bg-surface-1 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <Card title={c.ev} help={c.evHelp}>
          <div className="grid grid-cols-2 gap-3"><Field label={c.odds} value={evOdds} onChange={setEvOdds} testId="ev-odds" /><Field label={c.prob} value={evProb} onChange={setEvProb} testId="ev-prob" /></div>
          <div className="mt-auto border-t border-line pt-4" data-testid="ev-result">
            <div className="text-micro u-label text-fg-dim">{c.evResult}</div>
            <div className={"nums text-h3 leading-none " + (ev > 0 ? "text-pos" : ev < 0 ? "text-neg" : "text-fg-muted")}>{Number.isFinite(ev) ? pct(ev, lang, true) : "—"}</div>
            <div className="mt-1 text-tiny text-fg-dim">{c.implied}: <span className="nums">{pct(impliedProbability(o), lang)}</span> · {c.edge}: <span className="nums">{Number.isFinite(o) ? pct(p - impliedProbability(o), lang, true) : "—"}</span></div>
          </div>
        </Card>
        <Card title={c.parlay} help={c.parlayHelp}>
          <div className="space-y-2">{legs.map((v, i) => <Field key={i} label={`${c.leg} ${i + 1}`} value={v} onChange={(x) => setLegs(legs.map((l, j) => (j === i ? x : l)))} testId={`leg-${i}`} />)}</div>
          <div className="mt-2 flex gap-2 text-tiny"><button onClick={() => setLegs([...legs, "1.90"])} className="text-fg-muted hover:text-fg">+ {c.leg}</button>{legs.length > 2 && <button onClick={() => setLegs(legs.slice(0, -1))} className="text-fg-dim hover:text-fg">−</button>}</div>
          <div className="mt-auto border-t border-line pt-4" data-testid="parlay-result">
            <div className="text-micro u-label text-fg-dim">{c.combined}</div>
            <div className="nums text-h2 font-semibold">{Number.isFinite(combined) ? formatDecimal(combined) : "—"}</div>
            <div className="mt-1 text-tiny text-fg-dim">{c.chance}: <span className="nums">{pct(impliedProbability(combined), lang)}</span> · {c.hold}: <span className="nums text-warn">{pct(hold, lang)}</span></div>
            <p className="mt-2 text-label text-fg-faint">{c.holdNote}</p>
          </div>
        </Card>
        <Card title={c.conv} help={c.convHelp}>
          <Field label="Decimal" value={convDec} onChange={setConvDec} testId="conv-dec" />
          <div className="mt-auto border-t border-line pt-4 text-base" data-testid="conv-result">
            <div className="flex justify-between"><span className="text-fg-dim">{c.american}</span><span className="nums">{american}</span></div>
            <div className="mt-2 flex justify-between"><span className="text-fg-dim">{c.implied}</span><span className="nums">{pct(impliedProbability(dec), lang)}</span></div>
          </div>
        </Card>
      </div>
      <Link href="/signup" className="mt-10 inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap bg-action text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover active:bg-action-active disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-faint">{c.cta}</Link>
    </section>
  );
}
