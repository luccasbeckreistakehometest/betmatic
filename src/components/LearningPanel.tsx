"use client";
import { formatUsd } from "@/lib/format";

import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/ui";

interface Run {
  id: string; status: string; windowStart: string; windowEnd: string; tickets: number; won: number; lost: number; summary: string;
  report: { wentRight?: string[]; wentWrong?: string[]; lessons?: string[]; confidence?: string; byMarket?: Record<string, { won: number; lost: number }> };
  promptFeedback: string; applied: number; costUsd: number; note: string; createdAt: string;
}

/**
 * What the agent learned from settled tickets, run by run. Each run can carry a proposed change to
 * the generation prompt; applying it is one click and goes through the same versioned path as
 * typed feedback, so it shows up in the prompt history with its rationale.
 */
export function LearningPanel() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => { const r = await fetch("/api/admin/learning", { cache: "no-store" }); if (r.ok) setRuns((await r.json()).runs); }, []);
  useEffect(() => { const id = setTimeout(() => void load(), 0); return () => clearTimeout(id); }, [load]);

  async function trigger(job: "settle" | "learn") {
    setBusy(job); setNote(null);
    const r = await fetch(`/api/cron/refresh?job=${job}`, { method: "POST" });
    const j = await r.json();
    setNote(j.error ? j.error : job === "settle" ? `Liquidação: ${j.settled} bilhete(s) liquidado(s), ${j.stillPending} ainda aguardando resultado.` : `Aprendizado: ${j.run.status} — ${j.run.summary || j.run.note}`);
    setBusy(null); await load();
  }
  async function apply(id: string) {
    setBusy(id); setNote(null);
    const r = await fetch("/api/admin/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    const j = await r.json();
    setNote(j.ok ? `Aplicado ao prompt.\n\n${j.rationale}` : j.error);
    setBusy(null); await load();
  }
  const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <Panel title="Aprendizado" meta={runs ? `${runs.length} run(s)` : undefined} action={
      <div className="flex gap-2">
        <button onClick={() => trigger("settle")} disabled={busy !== null} className="rounded-control border border-line-strong px-2 py-0.5 text-label text-fg-muted hover:border-line-control hover:text-fg disabled:bg-surface-3 disabled:text-fg-faint disabled:cursor-not-allowed">{busy === "settle" ? "liquidando…" : "Liquidar agora"}</button>
        <button onClick={() => trigger("learn")} disabled={busy !== null} className="rounded-control border border-line-strong px-2 py-0.5 text-label text-fg-muted hover:border-line-control hover:text-fg disabled:bg-surface-3 disabled:text-fg-faint disabled:cursor-not-allowed" data-testid="learn-now">{busy === "learn" ? "analisando…" : "Rodar aprendizado"}</button>
      </div>
    }>
      <p className="text-label text-fg-dim">A cada hora os jogos encerrados são liquidados (sem custo). Uma vez por dia o agente lê o que ganhou e perdeu, escreve o post-mortem e propõe uma mudança no prompt — você aplica com um clique. As taxas de acerto por fonte e mercado já entram em toda geração automaticamente.</p>
      {note && <p className="mt-3 whitespace-pre-wrap rounded-control border border-line bg-surface-1 px-3 py-2 text-tiny text-fg-muted" data-testid="learn-note">{note}</p>}
      <ul className="mt-3 divide-y divide-line">
        {runs?.length ? runs.map((r) => (
          <li key={r.id} className="py-3 text-tiny" data-testid="learning-run">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-fg-dim">{fmt(r.windowStart)} → {fmt(r.windowEnd)}</span>
              <span className={r.status === "ok" ? "text-pos" : r.status === "error" ? "text-neg" : "text-fg-dim"}>{r.status}</span>
              <span className="nums text-fg-muted">{r.tickets} bilhetes · {r.won}W {r.lost}L</span>
              {r.report?.confidence && <span className="text-fg-dim">confiança {r.report.confidence}</span>}
              {r.costUsd > 0 && <span className="nums text-fg-dim">{formatUsd(r.costUsd, "pt", { digits: 3 })}</span>}
              <button onClick={() => setOpen(open === r.id ? null : r.id)} className="ml-auto text-fg-muted hover:text-fg">{open === r.id ? "fechar" : "detalhes"}</button>
            </div>
            <p className="mt-1 text-fg">{r.summary || r.note}</p>
            {open === r.id && r.status === "ok" && (
              <div className="mt-2 grid gap-3 rounded-control border border-line bg-surface-0 p-3 sm:grid-cols-2">
                <List title="Funcionou" items={r.report.wentRight} /><List title="Falhou" items={r.report.wentWrong} />
                <div className="sm:col-span-2"><List title="Lições" items={r.report.lessons} /></div>
              </div>
            )}
            {r.promptFeedback && (
              <div className="mt-2 rounded-control border border-pos bg-action px-3 py-2">
                <p className="text-micro u-label text-fg-dim">Proposta pro prompt</p>
                <p className="mt-1 whitespace-pre-wrap text-fg">{r.promptFeedback}</p>
                <div className="mt-2">{r.applied ? <span className="text-pos">aplicada ✓</span> : <button onClick={() => apply(r.id)} disabled={busy !== null} className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap bg-action text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover active:bg-action-active disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-faint" data-testid="learn-apply">{busy === r.id ? "aplicando…" : "Aplicar no prompt"}</button>}</div>
              </div>
            )}
          </li>
        )) : <li className="py-3 text-tiny text-fg-dim">Nenhuma run ainda. A primeira roda sozinha 24h depois do deploy, ou agora pelo botão.</li>}
      </ul>
    </Panel>
  );
}
const List = ({ title, items }: { title: string; items?: string[] }) => items?.length ? (
  <div><p className="text-micro u-label text-fg-dim">{title}</p><ul className="mt-1 space-y-1">{items.map((t) => <li key={t} className="text-fg-muted">· {t}</li>)}</ul></div>
) : null;
