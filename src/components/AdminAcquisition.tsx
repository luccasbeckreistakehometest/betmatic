"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/ui";
import type { AcquisitionReport } from "@/lib/server/analytics-report";

const FEATURE_LABEL: Record<string, string> = {
  game_generated: "jogos gerados", ticket_saved: "bilhetes salvos", custom_parlay_done: "múltiplas sob medida", deep_slip_done: "análises profundas",
  scan_done: "prints lidos", tipster_audit_done: "raio-x de tipster", player_opened: "raio-x de jogador", refresh_done: "atualizações Max",
  live_panel_open: "painel ao vivo", alt_expanded: "alternativas abertas", tool_used: "calculadoras", share_clicked: "compartilhamentos", telegram_link_started: "Telegram iniciado",
};

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

/** Admin: where visitors come from and how far they get. First-party events only, no IP. */
export function AdminAcquisition() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<AcquisitionReport | null>(null);
  const [utm, setUtm] = useState({ path: "/", source: "whatsapp", medium: "social", campaign: "" });
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      setOrigin(window.location.origin);
      fetch(`/api/admin/analytics?days=${days}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive) setData(j); }).catch(() => {});
    }, 0);
    return () => { alive = false; clearTimeout(id); };
  }, [days]);

  const link = useMemo(() => {
    const q = new URLSearchParams({ utm_source: utm.source, utm_medium: utm.medium, ...(utm.campaign ? { utm_campaign: utm.campaign } : {}) });
    return `${origin}${utm.path.startsWith("/") ? utm.path : `/${utm.path}`}?${q}`;
  }, [utm, origin]);
  const top = Math.max(1, ...(data?.visitorsPerDay.map((d) => d.visitors) ?? [1]));
  const field = "rounded-control border border-line-control bg-surface-1 px-2 py-1 text-tiny text-fg";

  return (
    <Panel title="Aquisição" meta={data ? `${data.totals.visitors} visitantes · ${data.totals.signups} cadastros · ${data.totals.paid} pagantes` : undefined}
      action={<span className="flex gap-1">{[7, 30, 90].map((d) => <button key={d} onClick={() => setDays(d)} className={`rounded-control px-2 py-0.5 text-label ${days === d ? "bg-surface-3 text-fg" : "text-fg-dim"}`}>{d}d</button>)}</span>}>
      {!data ? <p className="text-tiny text-fg-dim">…</p> : (
        <div className="flex flex-col gap-4 text-tiny" data-testid="admin-acquisition">
          <div>
            <h3 className="mb-1 text-micro u-label text-fg-dim">Visitantes por dia</h3>
            {data.visitorsPerDay.length ? (
              <svg viewBox={`0 0 ${Math.max(1, data.visitorsPerDay.length) * 24} 80`} className="h-20 w-full" preserveAspectRatio="none" role="img" aria-label="Visitantes por dia">
                {data.visitorsPerDay.map((d, i) => <rect key={d.day} x={i * 24 + 3} width={18} y={80 - (d.visitors / top) * 76} height={(d.visitors / top) * 76} rx={2} fill="var(--focus)"><title>{`${d.day}: ${d.visitors}`}</title></rect>)}
              </svg>
            ) : <p className="text-fg-dim">Nenhuma visita registrada no período.</p>}
          </div>
          {/* Six columns never fit a phone: below 768px the rows become definition lists (§11.1),
              the column label coming back on each cell through data-label. */}
          <div className="overflow-x-auto">
            <table className="w-full text-left" data-testid="acq-funnel" data-collapse="true">
              <thead><tr className="text-micro u-label text-fg-dim"><th className="pb-1">Origem</th><th>Visitantes</th><th>Cadastros</th><th>Abriu jogo</th><th>Salvou</th><th>Pagou</th></tr></thead>
              <tbody>
                {data.funnel.map((f) => (
                  <tr key={f.source} className="nums text-fg">
                    <td className="py-1 text-fg" data-label="Origem">{f.source}</td><td data-label="Visitantes">{f.visitors}</td><td data-label="Cadastros">{f.signups} <span className="text-fg-dim">({pct(f.signups, f.visitors)})</span></td>
                    <td data-label="Abriu jogo">{f.firstGame}</td><td data-label="Salvou">{f.saved}</td><td data-label="Pagou">{f.paid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <h3 className="mb-1 text-micro u-label text-fg-dim">Páginas de jogo mais vistas</h3>
              {data.topGames.length ? <ul>{data.topGames.map((g) => <li key={g.path} className="nums flex justify-between gap-2"><span className="truncate text-fg-muted">{g.path}</span><span className="text-fg-dim">{g.views} · {g.signups} cad.</span></li>)}</ul> : <p className="text-fg-dim">—</p>}
            </div>
            <div>
              <h3 className="mb-1 text-micro u-label text-fg-dim">Retorno</h3>
              <p className="nums text-fg-muted">D1: {data.retention.d1.returned}/{data.retention.d1.eligible} ({pct(data.retention.d1.returned, data.retention.d1.eligible)})</p>
              <p className="nums text-fg-muted">D7: {data.retention.d7.returned}/{data.retention.d7.eligible} ({pct(data.retention.d7.returned, data.retention.d7.eligible)})</p>
            </div>
            <div>
              <h3 className="mb-1 text-micro u-label text-fg-dim">Uso dos recursos</h3>
              {data.features.length ? <ul>{data.features.map((f) => <li key={f.name} className="nums flex justify-between"><span className="text-fg-muted">{FEATURE_LABEL[f.name] ?? f.name}</span><span className="text-fg-dim">{f.count}</span></li>)}</ul> : <p className="text-fg-dim">—</p>}
            </div>
          </div>
          <div className="rounded-control border border-line p-3" data-testid="utm-builder">
            <h3 className="mb-2 text-micro u-label text-fg-dim">Link com UTM (para WhatsApp, Instagram…)</h3>
            <div className="flex flex-wrap gap-2">
              <input aria-label="Página" className={field} value={utm.path} onChange={(e) => setUtm({ ...utm, path: e.target.value })} />
              <input aria-label="utm_source" className={field} value={utm.source} onChange={(e) => setUtm({ ...utm, source: e.target.value })} />
              <input aria-label="utm_medium" className={field} value={utm.medium} onChange={(e) => setUtm({ ...utm, medium: e.target.value })} />
              <input aria-label="utm_campaign" className={field} placeholder="campanha" value={utm.campaign} onChange={(e) => setUtm({ ...utm, campaign: e.target.value })} />
            </div>
            <p className="nums mt-2 break-all text-fg" data-testid="utm-link">{link}</p>
            <button onClick={() => void navigator.clipboard?.writeText(link)} className="mt-1 rounded-control border border-line-control px-2 py-0.5 text-label text-fg-muted">Copiar</button>
          </div>
        </div>
      )}
    </Panel>
  );
}
