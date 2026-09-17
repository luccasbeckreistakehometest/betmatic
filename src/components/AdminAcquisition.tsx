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
  const field = "rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[12px] text-mist-100";

  return (
    <Panel title="Aquisição" meta={data ? `${data.totals.visitors} visitantes · ${data.totals.signups} cadastros · ${data.totals.paid} pagantes` : undefined}
      action={<span className="flex gap-1">{[7, 30, 90].map((d) => <button key={d} onClick={() => setDays(d)} className={`rounded px-2 py-0.5 text-[11px] ${days === d ? "bg-ink-700 text-mist-100" : "text-mist-500"}`}>{d}d</button>)}</span>}>
      {!data ? <p className="text-[12px] text-mist-500">…</p> : (
        <div className="flex flex-col gap-4 text-[12px]" data-testid="admin-acquisition">
          <div>
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mist-500">Visitantes por dia</h3>
            {data.visitorsPerDay.length ? (
              <svg viewBox={`0 0 ${Math.max(1, data.visitorsPerDay.length) * 24} 80`} className="h-20 w-full" preserveAspectRatio="none" role="img" aria-label="Visitantes por dia">
                {data.visitorsPerDay.map((d, i) => <rect key={d.day} x={i * 24 + 3} width={18} y={80 - (d.visitors / top) * 76} height={(d.visitors / top) * 76} rx={2} fill="var(--color-signal-400)"><title>{`${d.day}: ${d.visitors}`}</title></rect>)}
              </svg>
            ) : <p className="text-mist-500">Nenhuma visita registrada no período.</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left" data-testid="acq-funnel">
              <thead><tr className="text-[10px] uppercase tracking-wider text-mist-500"><th className="pb-1">Origem</th><th>Visitantes</th><th>Cadastros</th><th>Abriu jogo</th><th>Salvou</th><th>Pagou</th></tr></thead>
              <tbody className="divide-y divide-ink-800">
                {data.funnel.map((f) => (
                  <tr key={f.source} className="nums text-mist-200">
                    <td className="py-1 text-mist-100">{f.source}</td><td>{f.visitors}</td><td>{f.signups} <span className="text-mist-500">({pct(f.signups, f.visitors)})</span></td>
                    <td>{f.firstGame}</td><td>{f.saved}</td><td>{f.paid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mist-500">Páginas de jogo mais vistas</h3>
              {data.topGames.length ? <ul>{data.topGames.map((g) => <li key={g.path} className="nums flex justify-between gap-2"><span className="truncate text-mist-300">{g.path}</span><span className="text-mist-500">{g.views} · {g.signups} cad.</span></li>)}</ul> : <p className="text-mist-500">—</p>}
            </div>
            <div>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mist-500">Retorno</h3>
              <p className="nums text-mist-300">D1: {data.retention.d1.returned}/{data.retention.d1.eligible} ({pct(data.retention.d1.returned, data.retention.d1.eligible)})</p>
              <p className="nums text-mist-300">D7: {data.retention.d7.returned}/{data.retention.d7.eligible} ({pct(data.retention.d7.returned, data.retention.d7.eligible)})</p>
            </div>
            <div>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mist-500">Uso dos recursos</h3>
              {data.features.length ? <ul>{data.features.map((f) => <li key={f.name} className="nums flex justify-between"><span className="text-mist-300">{FEATURE_LABEL[f.name] ?? f.name}</span><span className="text-mist-500">{f.count}</span></li>)}</ul> : <p className="text-mist-500">—</p>}
            </div>
          </div>
          <div className="rounded-lg border border-ink-800 p-3" data-testid="utm-builder">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-mist-500">Link com UTM (para WhatsApp, Instagram…)</h3>
            <div className="flex flex-wrap gap-2">
              <input aria-label="Página" className={field} value={utm.path} onChange={(e) => setUtm({ ...utm, path: e.target.value })} />
              <input aria-label="utm_source" className={field} value={utm.source} onChange={(e) => setUtm({ ...utm, source: e.target.value })} />
              <input aria-label="utm_medium" className={field} value={utm.medium} onChange={(e) => setUtm({ ...utm, medium: e.target.value })} />
              <input aria-label="utm_campaign" className={field} placeholder="campanha" value={utm.campaign} onChange={(e) => setUtm({ ...utm, campaign: e.target.value })} />
            </div>
            <p className="nums mt-2 break-all text-mist-200" data-testid="utm-link">{link}</p>
            <button onClick={() => void navigator.clipboard?.writeText(link)} className="mt-1 rounded border border-ink-700 px-2 py-0.5 text-[11px] text-mist-300">Copiar</button>
          </div>
        </div>
      )}
    </Panel>
  );
}
