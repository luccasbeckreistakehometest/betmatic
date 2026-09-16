"use client";

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
        <button onClick={() => trigger("settle")} disabled={busy !== null} className="rounded-md border border-ink-700 px-2 py-0.5 text-[11px] text-mist-400 hover:border-ink-600 hover:text-mist-100 disabled:opacity-50">{busy === "settle" ? "liquidando…" : "Liquidar agora"}</button>
        <button onClick={() => trigger("learn")} disabled={busy !== null} className="rounded-md border border-ink-700 px-2 py-0.5 text-[11px] text-mist-400 hover:border-ink-600 hover:text-mist-100 disabled:opacity-50" data-testid="learn-now">{busy === "learn" ? "analisando…" : "Rodar aprendizado"}</button>
      </div>
    }>
      <p className="text-[11px] text-mist-500">A cada hora os jogos encerrados são liquidados (sem custo). Uma vez por dia o agente lê o que ganhou e perdeu, escreve o post-mortem e propõe uma mudança no prompt — você aplica com um clique. As taxas de acerto por fonte e mercado já entram em toda geração automaticamente.</p>
      {note && <p className="mt-3 whitespace-pre-wrap rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-[12px] text-mist-300" data-testid="learn-note">{note}</p>}
      <ul className="mt-3 divide-y divide-ink-800">
        {runs?.length ? runs.map((r) => (
          <li key={r.id} className="py-3 text-[12px]" data-testid="learning-run">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-mist-500">{fmt(r.windowStart)} → {fmt(r.windowEnd)}</span>
              <span className={r.status === "ok" ? "text-signal-400" : r.status === "error" ? "text-warn-400" : "text-mist-500"}>{r.status}</span>
              <span className="nums text-mist-300">{r.tickets} bilhetes · {r.won}W {r.lost}L</span>
              {r.report?.confidence && <span className="text-mist-500">confiança {r.report.confidence}</span>}
              {r.costUsd > 0 && <span className="nums text-mist-500">${r.costUsd.toFixed(3)}</span>}
              <button onClick={() => setOpen(open === r.id ? null : r.id)} className="ml-auto text-mist-400 hover:text-mist-100">{open === r.id ? "fechar" : "detalhes"}</button>
            </div>
            <p className="mt-1 text-mist-200">{r.summary || r.note}</p>
            {open === r.id && r.status === "ok" && (
              <div className="mt-2 grid gap-3 rounded-lg border border-ink-800 bg-ink-950 p-3 sm:grid-cols-2">
                <List title="Funcionou" items={r.report.wentRight} /><List title="Falhou" items={r.report.wentWrong} />
                <div className="sm:col-span-2"><List title="Lições" items={r.report.lessons} /></div>
              </div>
            )}
            {r.promptFeedback && (
              <div className="mt-2 rounded-lg border border-edge-400/25 bg-edge-400/5 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-mist-500">Proposta pro prompt</p>
                <p className="mt-1 whitespace-pre-wrap text-mist-200">{r.promptFeedback}</p>
                <div className="mt-2">{r.applied ? <span className="text-signal-400">aplicada ✓</span> : <button onClick={() => apply(r.id)} disabled={busy !== null} className="rounded-md bg-edge-400 px-3 py-1 text-[12px] font-semibold text-ink-950 hover:bg-edge-500 disabled:opacity-50" data-testid="learn-apply">{busy === r.id ? "aplicando…" : "Aplicar no prompt"}</button>}</div>
              </div>
            )}
          </li>
        )) : <li className="py-3 text-[12px] text-mist-500">Nenhuma run ainda. A primeira roda sozinha 24h depois do deploy, ou agora pelo botão.</li>}
      </ul>
    </Panel>
  );
}
const List = ({ title, items }: { title: string; items?: string[] }) => items?.length ? (
  <div><p className="text-[10px] uppercase tracking-wider text-mist-500">{title}</p><ul className="mt-1 space-y-1">{items.map((t) => <li key={t} className="text-mist-300">· {t}</li>)}</ul></div>
) : null;
