"use client";

import { useCallback, useEffect, useState } from "react";
import { useNavState } from "@/components/Controls";
import { AppPageHead } from "@/components/AppPageHead";
import { Button, Empty, KPI, Panel } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { formatDecimal } from "@/lib/odds";
import { formatPercent as pctOf } from "@/lib/format";
import { makeT } from "@/lib/i18n";
import type { CalibrationReport, CalibrationRow, LedgerEntry } from "@/lib/types";

interface Payload {
  admin: boolean;
  summary: { total: number; pending: number; settled: number; won: number };
  calibration: Partial<CalibrationReport>;
  specialisation?: CalibrationRow[];
  entries?: Pick<LedgerEntry, "id" | "outcome" | "title" | "matchup" | "combinedDecimal" | "legs">[];
}

const OUTCOME_TONE: Record<string, string> = {
  won: "text-pos",
  lost: "text-neg",
  push: "text-fg-muted",
  void: "text-fg-dim",
  pending: "text-fg-muted",
};

const OUTCOME_LABEL: Record<string, { pt: string; en: string }> = {
  won: { pt: "ganhou", en: "won" },
  lost: { pt: "perdeu", en: "lost" },
  push: { pt: "devolvida", en: "push" },
  void: { pt: "anulada", en: "void" },
  pending: { pt: "pendente", en: "pending" },
};
const outcomeLabel = (outcome: string, lang: "pt" | "en") => OUTCOME_LABEL[outcome]?.[lang] ?? outcome;

function CalibrationTable({ rows, lang, emptyKey }: { rows: CalibrationRow[]; lang: "pt" | "en"; emptyKey: "noneBySource" | "noneByMarket" | "noneSpecialisation" }) {
  const t = makeT(lang);
  if (!rows.length) return <Empty rows={2}>{t(emptyKey)}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-tiny">
        <thead>
          <tr>
            <th>—</th>
            <th className="text-right">{t("sample")}</th>
            <th className="text-right">{t("hitRate")}</th>
            <th className="text-right">{t("predicted")}</th>
            <th className="pl-6">{t("calibration")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const over = row.calibrationError > 0.05;
            const under = row.calibrationError < -0.05;
            return (
              <tr key={row.key}>
                <td className="text-fg">{row.label}</td>
                <td className="nums text-right text-fg-muted">
                  {row.won}/{row.settled}
                </td>
                <td
                  className={`nums text-right font-medium ${
                    row.hitRate >= 0.55 ? "text-pos" : row.hitRate <= 0.45 ? "text-neg" : "text-fg"
                  }`}
                >
                  {pctOf(row.hitRate, lang, { digits: 0 })}
                </td>
                <td className="nums text-right text-fg-muted">{pctOf(row.averagePredicted, lang, { digits: 0 })}</td>
                <td className={`pl-6 text-label ${over ? "text-warn" : under ? "text-fg-muted" : "text-fg-dim"}`}>
                  {over
                    ? `${t("overconfident")} ${formatNumber(row.calibrationError * 100, lang, { digits: 0 })} pts`
                    : under
                      ? `${t("underconfident")} ${formatNumber(-row.calibrationError * 100, lang, { digits: 0 })} pts`
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
    const response = await fetch(`/api/ledger?entries=1&lang=${lang}`, { cache: "no-store" });
    setData(await response.json());
  }, [lang]);

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
      <AppPageHead
        href="/app/track"
        meta={t("trackHint")}
        actions={data?.admin ? (
          <Button variant="primary" onClick={() => void settle()} loading={settling}>
            {settling ? t("settling") : t("settleNow")}
          </Button>
        ) : undefined}
      />

      {note && <p className="text-tiny text-fg-muted">{note}</p>}

      <div className="grid grid-cols-2 gap-x-8 gap-y-4 border-y border-line py-4 sm:grid-cols-4">
        {([
          [t("legs"), summary?.total ?? 0],
          [t("pending"), summary?.pending ?? 0],
          [t("settled"), summary?.settled ?? 0],
          [t("won"), summary?.won ?? 0],
        ] as const).map(([label, value]) => (
          <KPI key={String(label)} label={String(label)} value={formatNumber(Number(value), lang)} />
        ))}
      </div>

      {data?.admin && (
        <Panel title={t("bySource")} lang={lang}>
          <CalibrationTable rows={data?.calibration.bySource ?? []} lang={lang} emptyKey="noneBySource" />
        </Panel>
      )}

      <Panel title={t("byMarket")} lang={lang}>
        <CalibrationTable rows={data?.calibration.byMarket ?? []} lang={lang} emptyKey="noneByMarket" />
      </Panel>

      {data?.admin && (
        <Panel title={t("specialisation")} lang={lang}>
          <CalibrationTable rows={data?.specialisation ?? []} lang={lang} emptyKey="noneSpecialisation" />
        </Panel>
      )}

      <Panel title={t("recentTickets")} lang={lang} meta={data?.entries?.length ? String(data.entries.length) : undefined}>
        {data?.entries?.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {data.entries.slice(0, 25).map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-2 py-1.5">
                <span className={`text-label font-semibold uppercase ${OUTCOME_TONE[entry.outcome]}`}>
                  {outcomeLabel(entry.outcome, lang)}
                </span>
                <span className="text-tiny text-fg">{entry.title}</span>
                <span className="text-label text-fg-dim">{entry.matchup}</span>
                <span className="nums ml-auto text-label text-fg-muted">
                  {formatDecimal(entry.combinedDecimal, lang)} · {entry.legs.length}{" "}
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
          <Empty>{t("noneRecentTickets")}</Empty>
        )}
      </Panel>
    </div>
  );
}
