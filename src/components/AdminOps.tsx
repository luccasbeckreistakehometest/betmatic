"use client";
import { formatMoney, formatUsd } from "@/lib/format";

import { useCallback, useEffect, useState } from "react";
import { Empty, Panel, Select, Table, Td, Th, Tr } from "@/components/ui";

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
      <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar mensagens" >
        <option value="open">abertas</option><option value="answered">respondidas</option><option value="closed">fechadas</option><option value="">todas</option>
      </Select>
    }>
      {messages.length ? (
        <ul className="flex flex-col divide-y divide-line" data-testid="admin-inbox">
          {messages.map((m) => (
            <li key={m.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-fg">{m.name || "—"}</span>
                <a href={`mailto:${m.email}`} className="text-fg underline decoration-line-control underline-offset-2 hover:decoration-fg">{m.email}</a>
                {m.accountEmail && m.accountEmail !== m.email && <span className="text-fg-dim">conta: {m.accountEmail}</span>}
                <span className="rounded-control border border-line-strong px-1.5 text-label text-fg-muted">{m.topic}</span>
                <span className="text-label text-fg-dim">{m.lang} · {dt(m.createdAt)}</span>
                <Select value={m.status} onChange={(e) => void update(m.id, { status: e.target.value })} aria-label="Status" wrapperClassName="ml-auto">
                  <option value="open">aberta</option><option value="answered">respondida</option><option value="closed">fechada</option>
                </Select>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-fg-muted">{m.message}</p>
              <input defaultValue={m.adminNote} placeholder="Nota interna" aria-label="Nota interna" onBlur={(e) => { if (e.target.value !== m.adminNote) void update(m.id, { adminNote: e.target.value }); }}
                className="mt-2 w-full rounded-control border border-line bg-surface-1 px-2 py-1 text-tiny text-fg-muted" />
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
      <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar pagamentos" >
        <option value="">todos</option><option value="approved">aprovados</option><option value="pending">pendentes</option><option value="rejected">recusados</option><option value="refunded">estornados</option><option value="charged_back">contestados</option><option value="failed">falha ao abrir</option>
      </Select>
    }>
      {payments.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-tiny" data-testid="admin-payments">
            <thead><tr>
              <th>Data</th><th>Usuário</th><th>Item</th><th className="text-right">Valor</th><th>Status</th><th>MP</th>
            </tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="nums text-fg-muted">{dt(p.createdAt)}</td>
                  <td className="text-fg">{p.email ?? "(conta excluída)"}</td>
                  <td className="text-fg-muted">{p.kind}:{p.reference}{p.period ? `/${p.period}` : ""}</td>
                  <td className="nums text-right text-fg">{formatMoney(p.amount, "pt")}</td>
                  <td className={`${p.status === "approved" ? "text-pos" : p.status === "pending" ? "text-fg-muted" : "text-fg-muted"}`} title={p.statusDetail ?? ""}>{p.status}</td>
                  <td className="nums text-fg-dim">{p.providerPaymentId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Nenhum pagamento.</Empty>}
    </Panel>
  );
}

export interface AiPayload {
  spent: number;
  budget: number;
  exhausted: boolean;
  byDay: { day: string; costUsd: number; calls: number }[];
  provider?: string;
  configured?: boolean;
  models?: { judgement: string; extraction: string; cheap: string; live: string };
  adminDailyCap?: number;
  generations?: { userId: string; email: string | null; role: string | null; games: number; slates: number; costUsd: number }[];
}

export interface OpsPayload {
  ai?: AiPayload;
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
            <p className="nums text-h3 font-semibold text-fg">{formatUsd(ai.spent, "pt")} <span className="text-sm font-normal text-fg-muted">de {formatUsd(ai.budget, "pt")}</span></p>
            <div className="mt-2 h-2 overflow-hidden rounded-control bg-surface-3"><div className={`h-full ${ai.exhausted ? "bg-neg" : pct > 80 ? "bg-warn" : "bg-action"}`} style={{ width: `${pct}%` }} /></div>
            <p className="mt-2 text-tiny text-fg-muted">{ai.exhausted ? "Teto atingido: novas gerações estão bloqueadas até a virada do dia (AI_DAILY_BUDGET_USD)." : "Ajuste o teto com AI_DAILY_BUDGET_USD no .env (0 desliga a IA)."}</p>
            {ai.provider && (
              <dl className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-tiny text-fg-muted" data-testid="admin-ai-provider">
                <div className="flex gap-2">
                  <dt className="text-fg-dim">Provedor</dt>
                  <dd className="text-fg">{ai.provider}{ai.configured ? "" : " (sem chave)"}</dd>
                </div>
                {ai.models && (
                  <>
                    <div className="flex gap-2"><dt className="text-fg-dim">Julgamento</dt><dd className="nums text-fg">{ai.models.judgement}</dd></div>
                    <div className="flex gap-2"><dt className="text-fg-dim">Extração</dt><dd className="nums text-fg">{ai.models.extraction}</dd></div>
                    <div className="flex gap-2"><dt className="text-fg-dim">Barato / visão</dt><dd className="nums text-fg">{ai.models.cheap}</dd></div>
                    <div className="flex gap-2"><dt className="text-fg-dim">Ao vivo</dt><dd className="nums text-fg">{ai.models.live}</dd></div>
                  </>
                )}
              </dl>
            )}
            <ul className="mt-2 text-tiny text-fg-muted">
              {ai.byDay.map((d) => <li key={d.day} className="nums">{d.day}: {formatUsd(d.costUsd, "pt")} · {d.calls} chamadas</li>)}
            </ul>
          </div>
        ) : <Empty>—</Empty>}
      </Panel>
      <Panel title="Erros recentes" meta={`${data?.ops?.length ?? 0}`}>
        {data?.ops?.length ? (
          <ul className="max-h-64 divide-y divide-line overflow-y-auto text-tiny" data-testid="admin-ops">
            {data.ops.map((o) => (
              <li key={o.id} className="py-1.5">
                <span className={o.level === "error" ? "text-neg" : "text-warn"}>{o.scope}</span>
                <span className="ml-2 text-fg-dim">{dt(o.createdAt)}</span>
                <p className="break-words text-fg-muted">{o.message}</p>
              </li>
            ))}
          </ul>
        ) : <Empty>Nenhum erro registrado.</Empty>}
      </Panel>
      <div className="lg:col-span-2"><AdminGenerations ai={data?.ai} /></div>
    </div>
  );
}

/**
 * Who spent the model's money today. An admin login handed to someone else shows up here, against
 * the same allowance the cap counts.
 */
export function AdminGenerations({ ai }: { ai?: AiPayload }) {
  const rows = ai?.generations ?? [];
  const cap = ai?.adminDailyCap;
  return (
    <Panel title="Gerações de hoje" meta={cap === undefined ? undefined : `admin: ${cap}/dia`} flush>
      {rows.length ? (
        <Table caption="Gerações de hoje por usuário">
          <thead>
            <tr><Th>Usuário</Th><Th>Papel</Th><Th numeric>Jogos</Th><Th numeric>Múltiplas</Th><Th numeric>Custo (USD)</Th></tr>
          </thead>
          <tbody data-testid="admin-generations">
            {rows.map((r) => (
              <Tr key={r.userId} tone={r.role === "admin" && cap !== undefined && r.games >= cap ? "neg" : undefined}>
                <Td label="Usuário">{r.email ?? "(conta excluída)"}</Td>
                <Td label="Papel" className="text-fg-muted">{r.role ?? "—"}</Td>
                <Td numeric label="Jogos">{r.games}{r.role === "admin" && cap !== undefined ? `/${cap}` : ""}</Td>
                <Td numeric label="Múltiplas">{r.slates}</Td>
                <Td numeric label="Custo (USD)">{formatUsd(r.costUsd, "pt", { digits: 3 })}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : <Empty>Nenhuma geração hoje.</Empty>}
    </Panel>
  );
}
