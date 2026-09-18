"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDate, formatPercent, formatUnits } from "@/lib/format";
import { LineChart } from "@/components/Chart";
import { Empty, Panel, Select, Skeleton, Table, Td, Th, Tr } from "@/components/ui";
import { bandComparison, equityCurve, type BacktestRow } from "@/lib/ledger/backtest";
import { ODDS_BANDS } from "@/lib/odds";
import { SPORTS } from "@/lib/sports";
import type { Lang } from "@/lib/i18n";

/**
 * Cumulative units at flat 1u over the public ledger, as an inline SVG — no chart library. The
 * filters are the strategy backtest: "only band X", "only this sport", "only singles", "only
 * tickets with evidence ≥ N". Rows carry no text, so this is safe for any viewer.
 */
const C = {
  pt: {
    title: "Curva de unidades", intro: "1 unidade fixa em cada bilhete liquidado, na ordem em que os jogos acabaram. Os filtros respondem \"e se eu tivesse seguido só…\".",
    units: "unidades", roi: "ROI", drawdown: "queda máxima", streak: "maior sequência de derrotas", decided: "decididos", all: "todos", band: "Faixa", sport: "Esporte", kind: "Tipo", single: "simples", parlay: "múltiplas", minEvidence: "Evidência mínima",
    compare: "Se tivesse seguido só uma faixa", none: "Ainda não há bilhete decidido com esses filtros.", clear: "Limpar filtros", loading: "Carregando a curva…", first: "primeiro", last: "último", open: "abrir bilhete",
  },
  en: {
    title: "Equity curve", intro: "A flat one unit on every settled ticket, in the order the games ended. The filters answer \"what if I had only followed…\".",
    units: "units", roi: "ROI", drawdown: "max drawdown", streak: "longest losing streak", decided: "decided", all: "all", band: "Band", sport: "Sport", kind: "Type", single: "singles", parlay: "parlays", minEvidence: "Min. evidence",
    compare: "If you had followed only one band", none: "No decided ticket matches these filters yet.", clear: "Clear filters", loading: "Loading the curve…", first: "first", last: "last", open: "open ticket",
  },
};

const fmtU = (n: number, lang: Lang) => formatUnits(n, lang);
const fmtPct = (n: number, lang: Lang) => formatPercent(n, lang, { signed: true });
const tone = (n: number) => (n > 0 ? "text-pos" : n < 0 ? "text-neg" : "text-fg-muted");

export function EquityChart({ rows: initial, lang, compact = false, className = "" }: { rows?: BacktestRow[]; lang: Lang; compact?: boolean; className?: string }) {
  const c = C[lang];
  const [rows, setRows] = useState<BacktestRow[] | null>(initial ?? null);
  const [band, setBand] = useState("");
  const [sport, setSport] = useState("");
  const [kind, setKind] = useState("");
  const [minEvidence, setMinEvidence] = useState(0);

  useEffect(() => {
    if (initial) return;
    // Deferred so the effect itself sets no state synchronously.
    const id = setTimeout(() => { fetch("/api/public/backtest", { cache: "no-store" }).then((r) => r.json()).then((j) => setRows(j.rows ?? [])).catch(() => setRows([])); }, 0);
    return () => clearTimeout(id);
  }, [initial]);

  const kindFilter = kind === "single" || kind === "parlay" ? kind : null;
  const summary = useMemo(() => equityCurve(rows ?? [], { band: band || null, sport: sport || null, kind: kindFilter, minEvidence }), [rows, band, sport, kindFilter, minEvidence]);
  const comparison = useMemo(() => bandComparison(rows ?? [], { sport: sport || null, kind: kindFilter, minEvidence }), [rows, sport, kindFilter, minEvidence]);
  const sports = useMemo(() => [...new Set((rows ?? []).map((r) => r.sport))].map((key) => ({ key, label: SPORTS.find((s) => s.key === key)?.label[lang] ?? key })), [rows, lang]);
  const bandLabel = (key: string) => ODDS_BANDS.find((b) => b.key === key)?.label[lang] ?? key;

  const day = (iso: string) => formatDate(iso, lang);
  const filter = (label: string, testId: string, value: string | number, onChange: (v: string) => void, options: { value: string | number; label: string }[]) => (
    <label className="flex items-center gap-1.5 text-label u-label text-fg-dim">
      {label}
      <Select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} className="h-7 text-tiny">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </Select>
    </label>
  );

  return (
    <Panel
      title={c.title}
      meta={`${summary.decided} ${c.decided}`}
      className={className}
      data-testid="equity-curve"
    >
      {!compact && <p className="max-w-measure-app text-tiny text-fg-dim">{c.intro}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="curve-filters">
        {filter(c.band, "filter-band", band, setBand, [{ value: "", label: c.all }, ...ODDS_BANDS.map((b) => ({ value: b.key, label: b.label[lang] }))])}
        {filter(c.sport, "filter-sport", sport, setSport, [{ value: "", label: c.all }, ...sports.map((s) => ({ value: s.key, label: s.label }))])}
        {filter(c.kind, "filter-kind", kind, setKind, [{ value: "", label: c.all }, { value: "single", label: c.single }, { value: "parlay", label: c.parlay }])}
        {filter(c.minEvidence, "filter-evidence", minEvidence, (v) => setMinEvidence(Number(v)), [0, 40, 60, 70, 80].map((n) => ({ value: n, label: n === 0 ? c.all : `≥ ${n}` })))}
      </div>

      {/* The four numbers the curve is about, on one baseline — a row, not four boxes. */}
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line py-3 sm:grid-cols-4" data-testid="curve-stats">
        {([[c.units, fmtU(summary.units, lang), tone(summary.units)], [c.roi, summary.decided ? fmtPct(summary.roi, lang) : "—", tone(summary.roi)], [c.drawdown, formatUnits(-summary.maxDrawdown, lang), "text-fg"], [c.streak, String(summary.longestLosingStreak), "text-fg"]] as const).map(([k, v, cls]) => (
          <div key={k} className="flex flex-col gap-1.5">
            <span className="text-label u-label text-fg-dim">{k}</span>
            <span className={`nums text-lead leading-none ${cls}`}>{v}</span>
          </div>
        ))}
      </div>

      <div className="mt-4">
        {rows === null ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-40 w-full" />
            <Skeleton width="40%" />
          </div>
        ) : summary.decided === 0 ? (
          <div data-testid="curve-empty">
            <Empty
              action={
                band || sport || kind || minEvidence ? (
                  <button
                    type="button"
                    onClick={() => { setBand(""); setSport(""); setKind(""); setMinEvidence(0); }}
                    className="text-tiny text-fg underline underline-offset-2 hover:text-fg"
                  >
                    {c.clear}
                  </button>
                ) : undefined
              }
            >
              {c.none}
            </Empty>
          </div>
        ) : (
          <LineChart
            testId="curve"
            caption={`${c.title} — ${fmtU(summary.units, lang)}`}
            formatValue={(v) => formatUnits(v, lang)}
            firstLabel={`${c.first}: ${day(summary.points[0].at)}`}
            lastLabel={`${c.last}: ${day(summary.points[summary.points.length - 1].at)}`}
            points={summary.points.map((p, i) => ({
              x: i,
              value: p.units,
              label: day(p.at),
              href: `/p/${p.id}?lang=${lang}`,
              title: `${day(p.at)} · ${fmtU(p.delta, lang)} → ${fmtU(p.units, lang)} · ${c.open}`,
            }))}
          />
        )}
      </div>

      {!compact && comparison.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-label u-label text-fg-dim">{c.compare}</h3>
          <Table caption={c.compare} className="text-tiny">
            <thead>
              <tr>
                <Th>{c.band}</Th>
                <Th numeric>{c.decided}</Th>
                <Th numeric>{c.units}</Th>
                <Th numeric>{c.roi}</Th>
                <Th numeric>{c.drawdown}</Th>
                <Th numeric>{c.streak}</Th>
              </tr>
            </thead>
            <tbody>
              {comparison.map(({ band: b, summary: s }) => (
                <Tr key={b} selected={b === band} data-testid={`band-row-${b}`}>
                  <Td label={c.band}>
                    <button type="button" onClick={() => setBand(b === band ? "" : b)} className="text-fg underline-offset-2 hover:underline">
                      {bandLabel(b)}
                    </button>
                  </Td>
                  <Td numeric label={c.decided} className="text-fg-muted">{s.won}W {s.lost}L</Td>
                  <Td numeric label={c.units} className={tone(s.units)}>{fmtU(s.units, lang)}</Td>
                  <Td numeric label={c.roi} className={tone(s.roi)}>{fmtPct(s.roi, lang)}</Td>
                  <Td numeric label={c.drawdown} className="text-fg-muted">{formatUnits(-s.maxDrawdown, lang)}</Td>
                  <Td numeric label={c.streak} className="text-fg-muted">{s.longestLosingStreak}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Panel>
  );
}
