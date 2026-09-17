"use client";

import Link from "next/link";
import { useState } from "react";
import { expectedValue, formatDecimal, impliedProbability, parlayDecimal, parlayHold, parseOdds } from "@/lib/odds";
import type { Lang } from "@/lib/i18n";

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
  <label className="block text-[12px] text-mist-400">{label}<input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" data-testid={testId} className="nums mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[15px] text-mist-100 outline-none focus:border-edge-400" /></label>
);
const Card = ({ title, help, children }: { title: string; help: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border border-ink-800 bg-ink-900/60 p-6"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-[13px] text-mist-500">{help}</p><div className="mt-5">{children}</div></div>
);
const pct = (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—");

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
    <section className="mx-auto max-w-5xl px-5 py-12">
      <p className="text-[11px] uppercase tracking-[0.18em] text-edge-400">{c.eyebrow}</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">{c.title}</h1>
      <p className="mt-3 text-[15px] text-mist-400">{c.sub}</p>
      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        <Card title={c.ev} help={c.evHelp}>
          <div className="grid grid-cols-2 gap-3"><Field label={c.odds} value={evOdds} onChange={setEvOdds} testId="ev-odds" /><Field label={c.prob} value={evProb} onChange={setEvProb} testId="ev-prob" /></div>
          <div className="mt-4 rounded-lg bg-ink-950 p-4" data-testid="ev-result">
            <div className="text-[10px] uppercase tracking-wider text-mist-500">{c.evResult}</div>
            <div className={"nums text-3xl font-semibold " + (ev > 0 ? "text-signal-400" : ev < 0 ? "text-warn-400" : "text-mist-300")}>{Number.isFinite(ev) ? `${ev >= 0 ? "+" : ""}${pct(ev)}` : "—"}</div>
            <div className="mt-1 text-[12px] text-mist-500">{c.implied}: <span className="nums">{pct(impliedProbability(o))}</span> · {c.edge}: <span className="nums">{Number.isFinite(o) ? pct(p - impliedProbability(o)) : "—"}</span></div>
          </div>
        </Card>
        <Card title={c.parlay} help={c.parlayHelp}>
          <div className="space-y-2">{legs.map((v, i) => <Field key={i} label={`${c.leg} ${i + 1}`} value={v} onChange={(x) => setLegs(legs.map((l, j) => (j === i ? x : l)))} testId={`leg-${i}`} />)}</div>
          <div className="mt-2 flex gap-2 text-[12px]"><button onClick={() => setLegs([...legs, "1.90"])} className="text-mist-400 hover:text-mist-100">+ {c.leg}</button>{legs.length > 2 && <button onClick={() => setLegs(legs.slice(0, -1))} className="text-mist-500 hover:text-mist-100">−</button>}</div>
          <div className="mt-4 rounded-lg bg-ink-950 p-4" data-testid="parlay-result">
            <div className="text-[10px] uppercase tracking-wider text-mist-500">{c.combined}</div>
            <div className="nums text-3xl font-semibold">{Number.isFinite(combined) ? formatDecimal(combined) : "—"}</div>
            <div className="mt-1 text-[12px] text-mist-500">{c.chance}: <span className="nums">{pct(impliedProbability(combined))}</span> · {c.hold}: <span className="nums text-warn-400">{pct(hold)}</span></div>
            <p className="mt-2 text-[11px] text-mist-600">{c.holdNote}</p>
          </div>
        </Card>
        <Card title={c.conv} help={c.convHelp}>
          <Field label="Decimal" value={convDec} onChange={setConvDec} testId="conv-dec" />
          <div className="mt-4 rounded-lg bg-ink-950 p-4 text-[14px]" data-testid="conv-result">
            <div className="flex justify-between"><span className="text-mist-500">{c.american}</span><span className="nums">{american}</span></div>
            <div className="mt-2 flex justify-between"><span className="text-mist-500">{c.implied}</span><span className="nums">{pct(impliedProbability(dec))}</span></div>
          </div>
        </Card>
      </div>
      <Link href="/signup" className="mt-10 inline-block rounded-lg bg-edge-400 px-5 py-2.5 text-[14px] font-semibold text-ink-950 hover:bg-edge-500">{c.cta}</Link>
    </section>
  );
}
