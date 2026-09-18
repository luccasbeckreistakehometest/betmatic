"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import { bandComparison, curvePath, equityCurve, type BacktestRow } from "@/lib/ledger/backtest";
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
    compare: "Se tivesse seguido só uma faixa", none: "Ainda não há bilhete decidido com esses filtros.", loading: "Carregando a curva…", first: "primeiro", last: "último", open: "abrir bilhete",
  },
  en: {
    title: "Equity curve", intro: "A flat one unit on every settled ticket, in the order the games ended. The filters answer \"what if I had only followed…\".",
    units: "units", roi: "ROI", drawdown: "max drawdown", streak: "longest losing streak", decided: "decided", all: "all", band: "Band", sport: "Sport", kind: "Type", single: "singles", parlay: "parlays", minEvidence: "Min. evidence",
    compare: "If you had followed only one band", none: "No decided ticket matches these filters yet.", loading: "Loading the curve…", first: "first", last: "last", open: "open ticket",
  },
};

const fmtU = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}u`;
const fmtPct = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
const tone = (n: number) => (n > 0 ? "text-focus" : n < 0 ? "text-warn" : "text-fg-muted");

export function EquityChart({ rows: initial, lang, compact = false }: { rows?: BacktestRow[]; lang: Lang; compact?: boolean }) {
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

  const W = 640, H = compact ? 140 : 200, PAD = 8;
  const path = curvePath(summary.points, W, H, PAD);
  const day = (iso: string) => formatDate(iso, lang);
  const select = "rounded-control border border-line-strong bg-surface-1 px-2 py-1 text-tiny text-fg outline-none focus:border-pos";

  return (
    <section className="rounded-panel border border-line bg-surface-1 p-4" data-testid="equity-curve">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">{c.title}</h2>
        <span className="text-label text-fg-dim">{summary.decided} {c.decided}</span>
      </div>
      {!compact && <p className="mt-1 text-tiny text-fg-dim">{c.intro}</p>}

      <div className="mt-3 flex flex-wrap gap-2" data-testid="curve-filters">
        <label className="flex items-center gap-1.5 text-label text-fg-dim">{c.band}
          <select value={band} onChange={(e) => setBand(e.target.value)} className={select} data-testid="filter-band"><option value="">{c.all}</option>{ODDS_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label[lang]}</option>)}</select>
        </label>
        <label className="flex items-center gap-1.5 text-label text-fg-dim">{c.sport}
          <select value={sport} onChange={(e) => setSport(e.target.value)} className={select} data-testid="filter-sport"><option value="">{c.all}</option>{sports.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
        </label>
        <label className="flex items-center gap-1.5 text-label text-fg-dim">{c.kind}
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={select} data-testid="filter-kind"><option value="">{c.all}</option><option value="single">{c.single}</option><option value="parlay">{c.parlay}</option></select>
        </label>
        <label className="flex items-center gap-1.5 text-label text-fg-dim">{c.minEvidence}
          <select value={minEvidence} onChange={(e) => setMinEvidence(Number(e.target.value))} className={select} data-testid="filter-evidence">{[0, 40, 60, 70, 80].map((n) => <option key={n} value={n}>{n === 0 ? c.all : `≥ ${n}`}</option>)}</select>
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-control border border-line bg-surface-3 sm:grid-cols-4" data-testid="curve-stats">
        {[[c.units, fmtU(summary.units), tone(summary.units)], [c.roi, summary.decided ? fmtPct(summary.roi) : "—", tone(summary.roi)], [c.drawdown, `−${summary.maxDrawdown.toFixed(2)}u`, "text-fg"], [c.streak, String(summary.longestLosingStreak), "text-fg"]].map(([k, v, cls]) => (
          <div key={k} className="bg-surface-1 px-3 py-2"><div className="text-micro uppercase tracking-wider text-fg-dim">{k}</div><div className={`nums text-base font-semibold ${cls}`}>{v}</div></div>
        ))}
      </div>

      {rows === null ? <p className="mt-3 text-tiny text-fg-dim">{c.loading}</p> : summary.decided === 0 ? <p className="mt-3 text-tiny text-fg-dim" data-testid="curve-empty">{c.none}</p> : (
        <div className="mt-3">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${c.title}: ${fmtU(summary.units)}`} data-testid="curve-svg">
            <line x1={PAD} x2={W - PAD} y1={path.zeroY} y2={path.zeroY} stroke="#2f3646" strokeDasharray="4 4" />
            <path d={path.d} fill="none" stroke={summary.units >= 0 ? "#4ade80" : "#fbbf24"} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" data-testid="curve-path" />
            {summary.points.length <= 200 && summary.points.map((p, i) => (
              <a key={p.id} href={`/p/${p.id}?lang=${lang}`}>
                <circle cx={path.xOf(i + 1)} cy={path.yOf(p.units)} r={3} fill={p.outcome === "won" ? "#4ade80" : "#fbbf24"}><title>{`${day(p.at)} · ${fmtU(p.delta)} → ${fmtU(p.units)} · ${c.open}`}</title></circle>
              </a>
            ))}
            <text x={PAD} y={12} fill="#667085" fontSize={11}>{fmtU(path.max)}</text>
            <text x={PAD} y={H - 2} fill="#667085" fontSize={11}>{fmtU(path.min)}</text>
          </svg>
          <div className="mt-1 flex justify-between text-micro text-fg-dim"><span>{c.first}: {day(summary.points[0].at)}</span><span>{c.last}: {day(summary.points[summary.points.length - 1].at)}</span></div>
        </div>
      )}

      {!compact && comparison.length > 0 && (
        <div className="mt-4">
          <h3 className="text-label uppercase tracking-wider text-fg-dim">{c.compare}</h3>
          <table className="mt-2 w-full text-left text-tiny" data-testid="band-comparison">
            <thead><tr className="border-b border-line text-micro uppercase tracking-wider text-fg-dim"><th className="pb-1 font-medium">{c.band}</th><th className="pb-1 text-right font-medium">{c.decided}</th><th className="pb-1 text-right font-medium">{c.units}</th><th className="pb-1 text-right font-medium">{c.roi}</th><th className="pb-1 text-right font-medium">{c.drawdown}</th><th className="pb-1 text-right font-medium">{c.streak}</th></tr></thead>
            <tbody className="divide-y divide-line/70">
              {comparison.map(({ band: b, summary: s }) => (
                <tr key={b} className={b === band ? "bg-surface-2" : ""} data-testid={`band-row-${b}`}>
                  <td className="py-1.5"><button onClick={() => setBand(b === band ? "" : b)} className="text-fg hover:text-pos">{bandLabel(b)}</button></td>
                  <td className="nums py-1.5 text-right text-fg-muted">{s.won}W {s.lost}L</td>
                  <td className={`nums py-1.5 text-right ${tone(s.units)}`}>{fmtU(s.units)}</td>
                  <td className={`nums py-1.5 text-right ${tone(s.roi)}`}>{fmtPct(s.roi)}</td>
                  <td className="nums py-1.5 text-right text-fg-muted">−{s.maxDrawdown.toFixed(2)}u</td>
                  <td className="nums py-1.5 text-right text-fg-muted">{s.longestLosingStreak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
