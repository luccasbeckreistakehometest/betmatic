"use client";

import { useCallback, useEffect, useState } from "react";
import { useNavState } from "@/components/Controls";
import { Empty, Panel } from "@/components/ui";
import { formatDecimal, formatPercent } from "@/lib/odds";
import { makeT } from "@/lib/i18n";
import type { CalibrationReport, CalibrationRow, LedgerEntry } from "@/lib/types";

interface Payload {
  summary: { total: number; pending: number; settled: number; won: number };
  calibration: CalibrationReport;
  specialisation: CalibrationRow[];
  entries?: LedgerEntry[];
}

const OUTCOME_TONE: Record<string, string> = {
  won: "text-edge-400",
  lost: "text-alert-400",
  push: "text-mist-400",
  void: "text-mist-600",
  pending: "text-signal-400",
};

function CalibrationTable({ rows, lang }: { rows: CalibrationRow[]; lang: "pt" | "en" }) {
  const t = makeT(lang);
  if (!rows.length) return <Empty>{t("notEnoughData")}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-[12px]">
        <thead>
          <tr className="border-b border-ink-800 text-[10px] uppercase tracking-wider text-mist-500">
            <th className="px-2 pb-1.5 font-medium">—</th>
            <th className="px-2 pb-1.5 text-right font-medium">{t("sample")}</th>
            <th className="px-2 pb-1.5 text-right font-medium">{t("hitRate")}</th>
            <th className="px-2 pb-1.5 text-right font-medium">{t("predicted")}</th>
            <th className="px-2 pb-1.5 pl-6 font-medium">{t("calibration")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-800/70">
          {rows.map((row) => {
            const over = row.calibrationError > 0.05;
            const under = row.calibrationError < -0.05;
            return (
              <tr key={row.key}>
                <td className="px-2 py-1.5 text-mist-100">{row.label}</td>
                <td className="nums px-2 py-1.5 text-right text-mist-300">
                  {row.won}/{row.settled}
                </td>
                <td
                  className={`nums px-2 py-1.5 text-right font-medium ${
                    row.hitRate >= 0.55 ? "text-edge-400" : row.hitRate <= 0.45 ? "text-alert-400" : "text-mist-200"
                  }`}
                >
                  {formatPercent(row.hitRate, 0)}
                </td>
                <td className="nums px-2 py-1.5 text-right text-mist-400">{formatPercent(row.averagePredicted, 0)}</td>
                <td className={`px-2 py-1.5 pl-6 text-[11px] ${over ? "text-warn-400" : under ? "text-signal-400" : "text-mist-500"}`}>
                  {over
                    ? `${t("overconfident")} ${(row.calibrationError * 100).toFixed(0)}pts`
                    : under
                      ? `${t("underconfident")} ${(-row.calibrationError * 100).toFixed(0)}pts`
                      : t("wellCalibrated")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TrackRecord() {
  const { lang } = useNavState();
  const t = makeT(lang);
  const [data, setData] = useState<Payload | null>(null);
  const [settling, setSettling] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/ledger?entries=1", { cache: "no-store" });
    setData(await response.json());
  }, []);

  useEffect(() => {
    // The state update lands after the fetch resolves, not synchronously in the effect body.
    void (async () => {
      await Promise.resolve();
      await load();
    })();
  }, [load]);

  const settle = useCallback(async () => {
    setSettling(true);
    setNote(null);
    try {
      const response = await fetch("/api/ledger", { method: "POST" });
      const result = await response.json();
      setNote(
        lang === "pt"
          ? `${result.settled ?? 0} liquidados, ${result.stillPending ?? 0} ainda aguardando o jogo terminar.`
          : `${result.settled ?? 0} settled, ${result.stillPending ?? 0} still waiting for their game to finish.`,
      );
      await load();
    } finally {
      setSettling(false);
    }
  }, [lang, load]);

  const summary = data?.summary;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">{t("trackRecord")}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-mist-400">{t("trackHint")}</p>
        </div>
        <button
          onClick={() => void settle()}
          disabled={settling}
          className="rounded-lg bg-signal-500 px-3.5 py-1.5 text-[13px] font-medium text-ink-950 transition hover:bg-signal-400 disabled:opacity-50"
        >
          {settling ? t("settling") : t("settleNow")}
        </button>
      </div>

      {note && <p className="text-[12px] text-signal-400">{note}</p>}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-ink-800 bg-ink-800 sm:grid-cols-4">
        {[
          [t("legs"), summary?.total ?? 0],
          [t("pending"), summary?.pending ?? 0],
          [t("settled"), summary?.settled ?? 0],
          [t("won"), summary?.won ?? 0],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-ink-900 px-3 py-2.5 text-center">
            <div className="text-[10px] uppercase tracking-wider text-mist-500">{label}</div>
            <div className="nums text-lg font-semibold text-mist-100">{value}</div>
          </div>
        ))}
      </div>

      <Panel title={t("bySource")} lang={lang}>
        <CalibrationTable rows={data?.calibration.bySource ?? []} lang={lang} />
      </Panel>

      <Panel title={t("byMarket")} lang={lang}>
        <CalibrationTable rows={data?.calibration.byMarket ?? []} lang={lang} />
      </Panel>

      <Panel title={t("specialisation")} lang={lang}>
        <CalibrationTable rows={data?.specialisation ?? []} lang={lang} />
      </Panel>

      <Panel title={t("recentTickets")} lang={lang} meta={data?.entries?.length ? String(data.entries.length) : undefined}>
        {data?.entries?.length ? (
          <ul className="flex flex-col divide-y divide-ink-800">
            {data.entries.slice(0, 25).map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-2 py-1.5">
                <span className={`text-[11px] font-semibold uppercase ${OUTCOME_TONE[entry.outcome]}`}>
                  {entry.outcome}
                </span>
                <span className="text-[12px] text-mist-200">{entry.title}</span>
                <span className="text-[11px] text-mist-500">{entry.matchup}</span>
                <span className="nums ml-auto text-[11px] text-mist-400">
                  {formatDecimal(entry.combinedDecimal)} · {entry.legs.length}{" "}
                  {lang === "pt"
                    ? entry.legs.length === 1
                      ? "perna"
                      : "pernas"
                    : entry.legs.length === 1
                      ? "leg"
                      : "legs"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t("notEnoughData")}</Empty>
        )}
      </Panel>
    </div>
  );
}
