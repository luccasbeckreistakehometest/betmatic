"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Empty, Panel } from "@/components/ui";
import { useNavState } from "@/components/Controls";
import { makeT } from "@/lib/i18n";
import { formatDecimal } from "@/lib/odds";
import { EquityChart } from "@/components/EquityChart";
import { curvePath } from "@/lib/ledger/backtest";

interface Entry { id: string; source: "ticket" | "manual"; title: string; matchup: string; combinedDecimal: number; stake: number; outcome: string; pnl: number; createdAt: string; settledAt: string | null }
interface Payload { entries: Entry[]; totals: { staked: number; profit: number; roi: number; won: number; lost: number; pending: number }; error?: string }

export function BankrollBoard() {
  const { lang } = useNavState();
  const t = makeT(lang);
  const [data, setData] = useState<Payload | null>(null);
  const [title, setTitle] = useState(""); const [odds, setOdds] = useState(""); const [stake, setStake] = useState("");
  const money = (n: number) => (lang === "pt" ? `R$ ${n.toFixed(2)}` : `$${n.toFixed(2)}`);

  const load = useCallback(async () => { const r = await fetch("/api/bankroll", { cache: "no-store" }); setData(await r.json()); }, []);
  useEffect(() => { const id = setTimeout(() => void load(), 0); return () => clearTimeout(id); }, [load]);

  async function addManual() {
    await fetch("/api/bankroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "manual", title, odds: Number(odds), stake: Number(stake) }) });
    setTitle(""); setOdds(""); setStake(""); await load();
  }
  const grade = async (id: string, outcome: string) => { await fetch("/api/bankroll", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, outcome }) }); await load(); };
  const remove = async (id: string) => { await fetch(`/api/bankroll?id=${id}`, { method: "DELETE" }); await load(); };
  const tone = (o: string) => (o === "won" ? "text-signal-400" : o === "lost" ? "text-warn-400" : "text-mist-500");

  // The user's own money curve: decided entries in settlement order, cumulative profit in currency.
  const own = (data?.entries ?? []).filter((e) => e.outcome === "won" || e.outcome === "lost").sort((a, b) => (a.settledAt ?? a.createdAt).localeCompare(b.settledAt ?? b.createdAt));
  const ownPoints = own.reduce<{ units: number }[]>((acc, e) => [...acc, { units: (acc.at(-1)?.units ?? 0) + e.pnl }], []);
  const ownPath = curvePath(ownPoints, 640, 120, 8);

  if (data?.error) return <Panel title={t("bankroll")}><Empty>{t("signInForBankroll")}</Empty><Link href="/login" className="mt-2 inline-block text-[13px] text-edge-400 hover:underline">{t("navLogin" as never) || "Login"}</Link></Panel>;

  return (
    <div className="flex flex-col gap-4" data-testid="bankroll">
      <Panel title={t("bankroll")} meta={data ? `${data.totals.won}W ${data.totals.lost}L · ${data.totals.pending} ${lang === "pt" ? "pendentes" : "pending"}` : undefined}>
        <p className="text-[12px] text-mist-500">{t("bankrollIntro")}</p>
        {data && (
          <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-ink-800 bg-ink-800" data-testid="bankroll-totals">
            {[[t("staked"), money(data.totals.staked), ""], [t("profit"), `${data.totals.profit >= 0 ? "+" : ""}${money(data.totals.profit)}`, tone(data.totals.profit > 0 ? "won" : data.totals.profit < 0 ? "lost" : "")], [t("roi"), `${(data.totals.roi * 100).toFixed(1)}%`, tone(data.totals.roi > 0 ? "won" : data.totals.roi < 0 ? "lost" : "")]].map(([k, v, cls]) => (
              <div key={k as string} className="bg-ink-900 px-3 py-2.5"><div className="text-[10px] uppercase tracking-wider text-mist-500">{k}</div><div className={"nums text-lg font-semibold " + cls}>{v}</div></div>
            ))}
          </div>
        )}
        <ul className="mt-4 divide-y divide-ink-800">
          {data?.entries.length ? data.entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13px]" data-testid="bankroll-entry">
              <span className={"w-16 font-semibold " + tone(e.outcome)}>{{ won: t("markWon"), lost: t("markLost"), void: t("markVoid"), push: "push", pending: "…" }[e.outcome]}</span>
              <span className="min-w-0 flex-1 truncate text-mist-100">{e.title}<span className="text-mist-500"> {e.matchup}</span></span>
              <span className="nums text-mist-400">{formatDecimal(e.combinedDecimal)} · {money(e.stake)}</span>
              <span className={"nums w-24 text-right " + tone(e.outcome)}>{e.outcome === "won" || e.outcome === "lost" ? `${e.pnl >= 0 ? "+" : ""}${money(e.pnl)}` : ""}</span>
              {e.source === "manual" && e.outcome === "pending" && (
                <span className="flex gap-1 text-[11px]">{(["won", "lost", "void"] as const).map((o) => <button key={o} onClick={() => grade(e.id, o)} className="rounded border border-ink-700 px-1.5 py-0.5 text-mist-400 hover:text-mist-100">{{ won: t("markWon"), lost: t("markLost"), void: t("markVoid") }[o]}</button>)}</span>
              )}
              <button onClick={() => remove(e.id)} className="text-[11px] text-mist-600 hover:text-warn-400">✕</button>
            </li>
          )) : <li className="py-4"><Empty>{t("bankrollEmpty")}</Empty></li>}
        </ul>
      </Panel>
      {ownPoints.length >= 2 && (
        <Panel title={t("ownCurve")} meta={`${own.length} ${lang === "pt" ? "decididos" : "decided"}`}>
          <svg viewBox="0 0 640 120" className="h-auto w-full" role="img" data-testid="own-curve">
            <line x1={8} x2={632} y1={ownPath.zeroY} y2={ownPath.zeroY} stroke="#2f3646" strokeDasharray="4 4" />
            <path d={ownPath.d} fill="none" stroke={(ownPoints.at(-1)?.units ?? 0) >= 0 ? "#4ade80" : "#fbbf24"} strokeWidth={2} strokeLinejoin="round" />
            <text x={8} y={12} fill="#667085" fontSize={11}>{money(ownPath.max)}</text>
            <text x={8} y={118} fill="#667085" fontSize={11}>{money(ownPath.min)}</text>
          </svg>
        </Panel>
      )}
      <EquityChart lang={lang} />
      <Panel title={t("manualBet")}>
        <div className="grid gap-2 sm:grid-cols-[1fr_120px_120px_auto]">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={lang === "pt" ? "ex.: Flamengo vence @ Bet365" : "e.g. Lakers ML @ DraftKings"} className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13px] text-mist-100 outline-none focus:border-edge-400" data-testid="manual-title" />
          <input value={odds} onChange={(e) => setOdds(e.target.value)} placeholder="odd 1.85" inputMode="decimal" className="nums rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13px] text-mist-100 outline-none focus:border-edge-400" data-testid="manual-odds" />
          <input value={stake} onChange={(e) => setStake(e.target.value)} placeholder={t("stake")} inputMode="decimal" className="nums rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13px] text-mist-100 outline-none focus:border-edge-400" data-testid="manual-stake" />
          <button onClick={addManual} disabled={!title.trim() || !(Number(odds) > 1) || !(Number(stake) > 0)} className="rounded-lg bg-edge-400 px-3.5 py-2 text-[13px] font-semibold text-ink-950 hover:bg-edge-500 disabled:opacity-50" data-testid="manual-add">{t("addToBankroll")}</button>
        </div>
      </Panel>
    </div>
  );
}
