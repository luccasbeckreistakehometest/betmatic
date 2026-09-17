"use client";

import { useCallback, useEffect, useState } from "react";
import { Empty, Panel } from "@/components/ui";

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

interface Message { id: string; name: string; email: string; accountEmail: string | null; topic: string; message: string; lang: string; status: string; adminNote: string; createdAt: string }

/** Contact inbox with a status per message. */
export function AdminInbox() {
  const [filter, setFilter] = useState("open");
  const [messages, setMessages] = useState<Message[]>([]);
  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/contact?status=${filter}`, { cache: "no-store" });
    if (r.ok) setMessages((await r.json()).messages);
  }, [filter]);
  useEffect(() => { void (async () => { await Promise.resolve(); await load(); })(); }, [load]);

  async function update(id: string, patch: { status?: string; adminNote?: string }) {
    await fetch("/api/admin/contact", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...patch }) });
    await load();
  }

  return (
    <Panel title="Contato" meta={`${messages.length}`} action={
      <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar mensagens" className="rounded-md border border-ink-700 bg-ink-900 px-2 py-0.5 text-[12px] text-mist-200">
        <option value="open">abertas</option><option value="answered">respondidas</option><option value="closed">fechadas</option><option value="">todas</option>
      </select>
    }>
      {messages.length ? (
        <ul className="flex flex-col divide-y divide-ink-800" data-testid="admin-inbox">
          {messages.map((m) => (
            <li key={m.id} className="py-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-mist-100">{m.name || "—"}</span>
                <a href={`mailto:${m.email}`} className="text-edge-400 hover:underline">{m.email}</a>
                {m.accountEmail && m.accountEmail !== m.email && <span className="text-mist-500">conta: {m.accountEmail}</span>}
                <span className="rounded border border-ink-700 px-1.5 text-[11px] text-mist-400">{m.topic}</span>
                <span className="text-[11px] text-mist-500">{m.lang} · {dt(m.createdAt)}</span>
                <select value={m.status} onChange={(e) => void update(m.id, { status: e.target.value })} aria-label="Status" className="ml-auto rounded-md border border-ink-700 bg-ink-900 px-2 py-0.5 text-[12px] text-mist-200">
                  <option value="open">aberta</option><option value="answered">respondida</option><option value="closed">fechada</option>
                </select>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-mist-300">{m.message}</p>
              <input defaultValue={m.adminNote} placeholder="Nota interna" aria-label="Nota interna" onBlur={(e) => { if (e.target.value !== m.adminNote) void update(m.id, { adminNote: e.target.value }); }}
                className="mt-2 w-full rounded-md border border-ink-800 bg-ink-900 px-2 py-1 text-[12px] text-mist-300" />
            </li>
          ))}
        </ul>
      ) : <Empty>Nenhuma mensagem aqui.</Empty>}
    </Panel>
  );
}

interface Payment { id: string; email: string | null; kind: string; reference: string; period: string | null; amount: number; status: string; statusDetail: string | null; providerPaymentId: string | null; createdAt: string; settledAt: string | null }

export function AdminPayments() {
  const [filter, setFilter] = useState("");
  const [payments, setPayments] = useState<Payment[]>([]);
  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/payments?status=${filter}`, { cache: "no-store" });
    if (r.ok) setPayments((await r.json()).payments);
  }, [filter]);
  useEffect(() => { void (async () => { await Promise.resolve(); await load(); })(); }, [load]);

  return (
    <Panel title="Pagamentos" meta={`${payments.length}`} action={
      <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar pagamentos" className="rounded-md border border-ink-700 bg-ink-900 px-2 py-0.5 text-[12px] text-mist-200">
        <option value="">todos</option><option value="approved">aprovados</option><option value="pending">pendentes</option><option value="rejected">recusados</option><option value="refunded">estornados</option><option value="charged_back">contestados</option><option value="failed">falha ao abrir</option>
      </select>
    }>
      {payments.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12px]" data-testid="admin-payments">
            <thead><tr className="border-b border-ink-800 text-[10px] uppercase tracking-wider text-mist-500">
              <th className="px-2 pb-1.5">Data</th><th className="px-2 pb-1.5">Usuário</th><th className="px-2 pb-1.5">Item</th><th className="px-2 pb-1.5 text-right">Valor</th><th className="px-2 pb-1.5">Status</th><th className="px-2 pb-1.5">MP</th>
            </tr></thead>
            <tbody className="divide-y divide-ink-800/70">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="nums px-2 py-1.5 text-mist-400">{dt(p.createdAt)}</td>
                  <td className="px-2 py-1.5 text-mist-200">{p.email ?? "(conta excluída)"}</td>
                  <td className="px-2 py-1.5 text-mist-300">{p.kind}:{p.reference}{p.period ? `/${p.period}` : ""}</td>
                  <td className="nums px-2 py-1.5 text-right text-mist-100">R$ {p.amount.toFixed(2)}</td>
                  <td className={`px-2 py-1.5 ${p.status === "approved" ? "text-edge-400" : p.status === "pending" ? "text-signal-400" : "text-mist-400"}`} title={p.statusDetail ?? ""}>{p.status}</td>
                  <td className="nums px-2 py-1.5 text-mist-500">{p.providerPaymentId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Nenhum pagamento.</Empty>}
    </Panel>
  );
}

export interface OpsPayload {
  ai?: { spent: number; budget: number; exhausted: boolean; byDay: { day: string; costUsd: number; calls: number }[] };
  ops?: { id: string; level: string; scope: string; message: string; createdAt: string }[];
}

/** Today's AI spend against the ceiling, and the latest operator errors. */
export function AdminHealth({ data }: { data: OpsPayload | null }) {
  const ai = data?.ai;
  const pct = ai && ai.budget > 0 ? Math.min(100, (ai.spent / ai.budget) * 100) : 100;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Gasto de IA hoje" meta="dia de Brasília">
        {ai ? (
          <div data-testid="admin-ai-spend">
            <p className="nums text-[20px] font-semibold text-white">${ai.spent.toFixed(2)} <span className="text-[13px] font-normal text-mist-400">de ${ai.budget.toFixed(2)}</span></p>
            <div className="mt-2 h-2 overflow-hidden rounded bg-ink-800"><div className={`h-full ${ai.exhausted ? "bg-alert-400" : pct > 80 ? "bg-warn-400" : "bg-edge-400"}`} style={{ width: `${pct}%` }} /></div>
            <p className="mt-2 text-[12px] text-mist-400">{ai.exhausted ? "Teto atingido: novas gerações estão bloqueadas até a virada do dia (AI_DAILY_BUDGET_USD)." : "Ajuste o teto com AI_DAILY_BUDGET_USD no .env (0 desliga a IA)."}</p>
            <ul className="mt-2 text-[12px] text-mist-400">
              {ai.byDay.map((d) => <li key={d.day} className="nums">{d.day}: ${d.costUsd.toFixed(2)} · {d.calls} chamadas</li>)}
            </ul>
          </div>
        ) : <Empty>—</Empty>}
      </Panel>
      <Panel title="Erros recentes" meta={`${data?.ops?.length ?? 0}`}>
        {data?.ops?.length ? (
          <ul className="max-h-64 divide-y divide-ink-800 overflow-y-auto text-[12px]" data-testid="admin-ops">
            {data.ops.map((o) => (
              <li key={o.id} className="py-1.5">
                <span className={o.level === "error" ? "text-alert-400" : "text-warn-400"}>{o.scope}</span>
                <span className="ml-2 text-mist-500">{dt(o.createdAt)}</span>
                <p className="break-words text-mist-300">{o.message}</p>
              </li>
            ))}
          </ul>
        ) : <Empty>Nenhum erro registrado.</Empty>}
      </Panel>
    </div>
  );
}
