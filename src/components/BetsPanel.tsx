"use client";

import { Chip, Empty } from "@/components/ui";
import { formatDecimal, formatPercent, getBand } from "@/lib/odds";
import { makeT, type Lang } from "@/lib/i18n";
import type { BetSlate, BetSuggestion } from "@/lib/types";

function EdgeTag({ edgePct }: { edgePct: number }) {
  if (!Number.isFinite(edgePct)) return null;
  const positive = edgePct > 0;
  return (
    <span
      className={`nums rounded px-1.5 py-0.5 text-[10px] font-semibold ${
        positive ? "bg-edge-400/12 text-edge-400" : "bg-alert-400/10 text-alert-400"
      }`}
      title={positive ? "Modelled probability beats the price" : "Price is worse than the modelled chance"}
    >
      EV {positive ? "+" : ""}
      {edgePct.toFixed(1)}%
    </span>
  );
}

function Ticket({ bet, lang }: { bet: BetSuggestion; lang: Lang }) {
  const t = makeT(lang);
  const band = getBand(bet.bandKey);
  const longshot = bet.combinedDecimal >= 20;

  return (
    <li className="rounded-xl border border-ink-800 bg-ink-850/50">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-800 px-3.5 py-2.5">
        <Chip tone={bet.confidence}>{bet.kind === "parlay" ? t("parlay") : t("single")}</Chip>
        <span className="text-[13px] font-semibold text-mist-100">{bet.title}</span>
        <span className="ml-auto flex items-center gap-2">
          <EdgeTag edgePct={bet.edgePct} />
          <span className="nums rounded-lg bg-signal-500/12 px-2 py-0.5 text-[13px] font-bold text-signal-400">
            {formatDecimal(bet.combinedDecimal)}
          </span>
          <span className="nums text-[11px] text-mist-500">{bet.combinedAmerican}</span>
        </span>
      </div>

      <div className="px-3.5 py-3">
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-mist-500">{t("background")}</h4>
          <p className="mt-1 text-[12.5px] leading-relaxed text-mist-300">{bet.background}</p>
        </div>

        <ol className="mt-3 flex flex-col gap-2">
          {bet.legs.map((leg, i) => (
            <li key={i} className="rounded-lg border border-ink-800 bg-ink-900/60 p-2.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="nums text-[10px] text-mist-600">{i + 1}</span>
                <span className="text-[12.5px] font-medium text-mist-100">{leg.selection}</span>
                <span className="nums text-[12px] text-mist-300">{leg.odds}</span>
                {leg.book && <span className="text-[10px] text-mist-500">{leg.book}</span>}
                <span className="nums ml-auto text-[10px] text-mist-500">
                  {formatPercent(leg.fairProbability, 0)}
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-mist-400">{leg.explanation}</p>
              <p className="mt-1 border-l-2 border-signal-500/30 pl-2 text-[11.5px] leading-relaxed text-mist-500">
                <span className="font-medium text-mist-400">{t("evidence")}: </span>
                {leg.evidence}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-ink-800 bg-ink-800 sm:grid-cols-4">
          {[
            [t("combined"), formatDecimal(bet.combinedDecimal)],
            [t("impliedChance"), formatPercent(bet.impliedProbability, 2)],
            [t("modelledChance"), formatPercent(bet.modelledProbability, 2)],
            [t("evLabel"), Number.isFinite(bet.edgePct) ? `${bet.edgePct > 0 ? "+" : ""}${bet.edgePct.toFixed(1)}%` : "—"],
          ].map(([label, value]) => (
            <div key={label} className="bg-ink-900 px-2 py-1.5 text-center">
              <div className="text-[9px] uppercase tracking-wider text-mist-500">{label}</div>
              <div className="nums text-[12px] text-mist-200">{value}</div>
            </div>
          ))}
        </div>

        <p className="mt-2.5 text-[11.5px] leading-relaxed text-warn-400/90">
          <span className="font-medium">{t("risk")}: </span>
          {bet.riskNote}
        </p>
        {longshot && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-mist-500">
            {band.label[lang]} · {formatPercent(bet.impliedProbability, 2)} — {t("longshotWarning")}
          </p>
        )}
      </div>
    </li>
  );
}

export function BetsPanel({ slate, lang }: { slate: BetSlate | null | undefined; lang: Lang }) {
  const t = makeT(lang);
  if (!slate?.suggestions.length) {
    return (
      <>
        <Empty>{t("noBets")}</Empty>
        {slate?.dataNote && <p className="mt-2 text-[12px] leading-relaxed text-mist-500">{slate.dataNote}</p>}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {slate.suggestions.map((bet) => (
          <Ticket key={bet.id} bet={bet} lang={lang} />
        ))}
      </ul>
      {slate.dataNote && (
        <p className="border-t border-ink-800 pt-2.5 text-[11.5px] leading-relaxed text-mist-500">{slate.dataNote}</p>
      )}
    </div>
  );
}
