"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useNavState } from "@/components/Controls";
import { DeepSlipTable } from "@/components/DeepSlipTable";
import { SLIP_PREFILL_KEY, SlipScanner } from "@/components/SlipScanner";
import type { DeepContext } from "@/lib/server/deep-slip";
import { Chip, Panel } from "@/components/ui";
import { formatDecimal, formatPercent, parseOdds, parlayDecimal } from "@/lib/odds";
import { ACTION_COST } from "@/lib/plans";
import { makeT } from "@/lib/i18n";

interface Leg {
  selection: string;
  market: string;
  odds: string;
}

interface Analysis {
  verdict: string;
  legs: { index: number; assessment: string; fairProbability: number; concern: string }[];
  weakestIndex: number;
  swaps: { replaceIndex: number; suggestion: string; effect: string }[];
  correlationNote: string;
  combinedDecimal: number;
  combinedAmerican: string;
  impliedProbability: number;
  modelledProbability: number;
  edgePct: number;
}

const CONCERN_TONE: Record<string, string> = {
  none: "text-pos",
  minor: "text-warn",
  serious: "text-neg",
};

const emptyLeg: Leg = { selection: "", market: "", odds: "" };

export function SlipBuilder() {
  const { lang, sport } = useNavState();
  const t = makeT(lang);
  const [legs, setLegs] = useState<Leg[]>([{ ...emptyLeg }, { ...emptyLeg }]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [deepCtx, setDeepCtx] = useState<DeepContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const [pricing, setPricing] = useState<{ normal: number; deep: number; deepIncluded: boolean }>({ normal: ACTION_COST.analyse_slip, deep: ACTION_COST.deep_slip, deepIncluded: false });

  useEffect(() => {
    // Deferred so the effect itself sets no state synchronously.
    const id = setTimeout(() => {
      // A print sent from the scanner arrives here with its legs already filled in.
      try {
        const raw = sessionStorage.getItem(SLIP_PREFILL_KEY);
        if (raw) {
          sessionStorage.removeItem(SLIP_PREFILL_KEY);
          const pre = (JSON.parse(raw) as Leg[]).filter((l) => l.selection).slice(0, 12);
          if (pre.length) setLegs(pre.length >= 2 ? pre : [...pre, { ...emptyLeg }]);
        }
      } catch { /* storage may be blocked */ }
      fetch("/api/slip", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
        if (j?.pricing) {
          setPricing(j.pricing);
          if (j.pricing.deepIncluded) setDeep(true);
        }
      }).catch(() => {});
    }, 0);
    return () => clearTimeout(id);
  }, []);
  const price = deep ? pricing.deep : pricing.normal;

  const update = (i: number, patch: Partial<Leg>) =>
    setLegs((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  // Priced live in the browser so the user sees the combined odds before spending a coin.
  const decimals = legs.map((l) => parseOdds(l.odds)).filter((d) => Number.isFinite(d) && d > 1);
  const combined = decimals.length >= 2 ? parlayDecimal(decimals) : NaN;
  const ready = legs.filter((l) => l.selection.trim() && Number.isFinite(parseOdds(l.odds))).length >= 2;

  async function analyse() {
    setBusy(true);
    setError(null);
    setDeepCtx(null);
    setAnalysis(null);
    try {
      const response = await fetch("/api/slip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang, deep, sport: sport.key, legs: legs.filter((l) => l.selection.trim()) }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.message ?? t("generateFailed"));
        return;
      }
      setAnalysis(result.analysis);
      setDeepCtx(result.deep ?? null);
      if (!result.analysis && result.message) setError(`${result.message} ${lang === "pt" ? "Os coins voltaram." : "Your coins are back."}`);
    } catch {
      setError(t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const field =
    "rounded-control border border-line-strong bg-surface-1 px-2.5 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-faint focus:border-pos";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lead font-semibold tracking-tight text-fg">{t("slipTitle")}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-muted">{t("slipHint")}</p>
      </div>

      <SlipScanner lang={lang} sportKey={sport.key} />

      <Panel title={t("slipTitle")} lang={lang} meta={Number.isFinite(combined) ? formatDecimal(combined) : undefined}>
        <div className="flex flex-col gap-2.5">
          {legs.map((leg, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_140px_100px_auto]">
              <input
                className={field}
                aria-label={`${t("selection")} ${i + 1}`}
                maxLength={160}
                placeholder={t("selection")}
                value={leg.selection}
                onChange={(e) => update(i, { selection: e.target.value })}
              />
              <input
                className={field}
                aria-label={`${lang === "pt" ? "Mercado" : "Market"} ${i + 1}`}
                maxLength={60}
                placeholder={lang === "pt" ? "mercado" : "market"}
                value={leg.market}
                onChange={(e) => update(i, { market: e.target.value })}
              />
              <input
                className={`${field} nums`}
                aria-label={`${t("odds")} ${i + 1}`}
                maxLength={12}
                placeholder="-110"
                value={leg.odds}
                onChange={(e) => update(i, { odds: e.target.value })}
              />
              <button
                onClick={() => setLegs((prev) => prev.filter((_, idx) => idx !== i))}
                disabled={legs.length <= 2}
                className="rounded-control border border-line-strong px-2 text-label text-fg-dim transition hover:text-neg disabled:opacity-30"
              >
                {t("removeLeg")}
              </button>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              onClick={() => setLegs((prev) => [...prev, { ...emptyLeg }])}
              className="rounded-control border border-line-strong px-3 py-1.5 text-tiny text-fg-muted transition hover:border-line-control hover:text-fg"
            >
              + {t("addLeg")}
            </button>
            <button
              onClick={() => void analyse()}
              disabled={!ready || busy}
              className="rounded-control bg-action px-4 py-1.5 text-sm font-semibold text-action-fg transition hover:bg-action disabled:opacity-40"
            >
              {busy ? t("analysing") : t("analyseSlip")}
            </button>
            <span className="nums text-label text-fg-dim" data-testid="slip-price">
              {t("costsCoins")} {price} coins
            </span>
            <label className="flex items-center gap-1.5 text-tiny text-fg-muted" data-testid="deep-toggle">
              <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} className="size-4 appearance-none rounded-control border border-line-control bg-surface-3 checked:border-action checked:bg-action" />
              {lang === "pt" ? "Análise profunda" : "Deep analysis"}
              <span className="text-label text-fg-dim">
                {pricing.deepIncluded
                  ? (lang === "pt" ? `(incluída no Max: ${pricing.deep} coins)` : `(included in Max: ${pricing.deep} coins)`)
                  : `(${pricing.deep} coins)`}
              </span>
            </label>
            {!ready && <span className="text-label text-fg-faint">{t("slipEmpty")}</span>}
          </div>

          {deep && (
            <p className="text-tiny leading-relaxed text-fg-dim">
              {lang === "pt"
                ? "Na análise profunda cada perna é conferida antes do veredito: jogo e jogador encontrados, quantas vezes passou da linha, odd publicada sem a margem, papel no time, lesão e pernas que andam juntas."
                : "In the deep analysis each leg is checked before the verdict: game and player found, how often the line was cleared, the posted price without the margin, role, injuries and legs that move together."}
            </p>
          )}

          {error && (
            <p className="text-tiny text-neg">
              {error}{" "}
              <Link href={`/planos?lang=${lang}`} className="underline">
                {t("seePlans")}
              </Link>
            </p>
          )}
        </div>
      </Panel>

      {deepCtx && <DeepSlipTable ctx={deepCtx} lang={lang} sportKey={sport.key} />}

      {analysis && (
        <Panel title={t("slipVerdict")} lang={lang} status="ok">
          <div className="flex flex-col gap-4">
            <p className="text-base leading-relaxed text-fg">{analysis.verdict}</p>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-control border border-line bg-surface-3 sm:grid-cols-4">
              {[
                [t("combined"), formatDecimal(analysis.combinedDecimal)],
                [t("impliedChance"), formatPercent(analysis.impliedProbability, 2)],
                [t("modelledChance"), formatPercent(analysis.modelledProbability, 2)],
                [t("evLabel"), Number.isFinite(analysis.edgePct) ? `${analysis.edgePct > 0 ? "+" : ""}${analysis.edgePct.toFixed(1)}%` : "—"],
              ].map(([label, value]) => (
                <div key={label} className="bg-surface-1 px-2 py-1.5 text-center">
                  <div className="text-micro uppercase tracking-wider text-fg-dim">{label}</div>
                  <div className="nums text-tiny text-fg">{value}</div>
                </div>
              ))}
            </div>

            <ul className="flex flex-col gap-2">
              {analysis.legs.map((leg) => (
                <li
                  key={leg.index}
                  className={`rounded-control border p-3 ${
                    leg.index === analysis.weakestIndex ? "border-neg bg-neg-tint" : "border-line bg-surface-2"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="nums text-micro text-fg-faint">{leg.index + 1}</span>
                    <span className="text-tiny font-medium text-fg">
                      {legs[leg.index]?.selection ?? "—"}
                    </span>
                    <span className={`text-micro uppercase ${CONCERN_TONE[leg.concern] ?? "text-fg-dim"}`}>
                      {leg.concern}
                    </span>
                    {leg.index === analysis.weakestIndex && <Chip tone="low">{t("slipWeakest")}</Chip>}
                    <span className="nums ml-auto text-label text-fg-muted">
                      {formatPercent(leg.fairProbability, 0)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-tiny leading-relaxed text-fg-muted">{leg.assessment}</p>
                </li>
              ))}
            </ul>

            {analysis.swaps.length > 0 && (
              <div>
                <h3 className="text-micro font-semibold uppercase tracking-wider text-fg-dim">{t("slipSwaps")}</h3>
                <ul className="mt-2 flex flex-col gap-2">
                  {analysis.swaps.map((swap, i) => (
                    <li key={i} className="rounded-control border border-line bg-surface-2 p-3">
                      <p className="text-tiny leading-relaxed text-fg">{swap.suggestion}</p>
                      <p className="mt-1 text-tiny leading-relaxed text-fg-dim">{swap.effect}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="border-t border-line pt-2.5 text-tiny leading-relaxed text-fg-dim">
              {analysis.correlationNote}
            </p>
          </div>
        </Panel>
      )}
    </div>
  );
}
