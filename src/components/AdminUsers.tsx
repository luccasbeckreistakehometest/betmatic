"use client";
import { formatMoney } from "@/lib/format";

import { useCallback, useEffect, useState } from "react";
import { Empty, Panel } from "@/components/ui";
import { PLANS } from "@/lib/plans";

interface AdminUser {
  id: string; email: string; name: string; role: string; planId: string; planExpiresAt: string | null; planActive: boolean;
  coins: number; createdAt: string; lastSeenAt: string | null; disabledAt: string | null; mustChangePassword: boolean; termsAcceptedAt: string | null;
}
interface Detail {
  user: AdminUser;
  coinHistory: { id: string; delta: number; reason: string; balanceAfter: number; createdAt: string }[];
  payments: { id: string; kind: string; reference: string; period: string | null; amount: number; status: string; createdAt: string; providerPaymentId: string | null; statusDetail: string | null }[];
}

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const btn = "rounded-control border border-line-control px-2.5 py-1 text-tiny text-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:border-line-control disabled:bg-surface-3 disabled:text-fg-faint disabled:cursor-not-allowed";
const field = "rounded-control border border-line-control bg-surface-1 px-2.5 py-1.5 text-sm text-fg";

/** Support tools: find a user, see plan/coins/payments, and act (plan, coins, password, disable). */
export function AdminUsers() {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [otp, setOtp] = useState<string | null>(null);
  const [plan, setPlan] = useState({ planId: "pro", expiresAt: "" });
  const [coins, setCoins] = useState({ delta: "", note: "" });
  const [busy, setBusy] = useState(false);

  const search = useCallback(async (query: string) => {
    const r = await fetch(`/api/admin/users?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    if (r.ok) setUsers((await r.json()).users);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void search(q), 250);
    return () => clearTimeout(id);
  }, [q, search]);

  const open = useCallback(async (id: string) => {
    setOtp(null);
    setMsg(null);
    const r = await fetch(`/api/admin/users?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (r.ok) setDetail(await r.json());
  }, []);

  async function act(body: Record<string, unknown>) {
    if (!detail) return;
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: detail.user.id, ...body }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(`Erro: ${j.error ?? r.status}`); return; }
    if (j.oneTimePassword) setOtp(j.oneTimePassword);
    setMsg("Feito.");
    await open(detail.user.id);
    await search(q);
  }

  const u = detail?.user;
  return (
    <Panel title="Usuários" meta={`${users.length}`}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="flex flex-col gap-2">
          <label className="text-tiny text-fg-muted">Buscar por e-mail, nome ou id
            <input className={`${field} mt-1 w-full`} value={q} onChange={(e) => setQ(e.target.value)} data-testid="admin-user-search" />
          </label>
          <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto rounded-control border border-line" data-testid="admin-user-list">
            {users.map((row) => (
              <li key={row.id}>
                <button type="button" onClick={() => void open(row.id)} className={`flex w-full flex-wrap items-center gap-x-2 px-3 py-2 text-left text-tiny hover:bg-surface-2 ${detail?.user.id === row.id ? "bg-surface-2" : ""}`}>
                  <span className="min-w-0 flex-1 truncate text-fg">{row.email}</span>
                  <span className={row.role === "admin" ? "text-warn" : "text-fg-muted"}>{row.planActive ? row.planId : "free"}</span>
                  <span className="nums text-fg-dim">{row.coins}c</span>
                  {row.disabledAt && <span className="text-neg">desativado</span>}
                </button>
              </li>
            ))}
            {!users.length && <li className="px-3 py-2"><Empty>Ninguém encontrado.</Empty></li>}
          </ul>
        </div>

        {u ? (
          <div className="flex flex-col gap-4 text-sm" data-testid="admin-user-detail">
            <div>
              <p className="text-base font-semibold text-fg">{u.name} · {u.email}</p>
              <p className="text-fg-muted">id {u.id} · {u.role} · cadastro {dt(u.createdAt)} · último acesso {dt(u.lastSeenAt)}</p>
              <p className="text-fg-muted">Plano <strong className="text-fg">{u.planId}</strong> {u.planExpiresAt ? `até ${dt(u.planExpiresAt)}` : ""} {u.planActive ? "" : "(inativo)"} · <span className="nums">{u.coins}</span> coins</p>
              <p className="text-fg-dim">Termos aceitos: {dt(u.termsAcceptedAt)}{u.mustChangePassword ? " · deve trocar a senha" : ""}{u.disabledAt ? ` · desativado em ${dt(u.disabledAt)}` : ""}</p>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <label className="text-tiny text-fg-muted">Plano
                <select className={`${field} mt-1 block`} value={plan.planId} onChange={(e) => setPlan({ ...plan, planId: e.target.value })} data-testid="admin-plan">
                  {PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="text-tiny text-fg-muted">Vence em
                <input type="date" className={`${field} mt-1 block`} value={plan.expiresAt} onChange={(e) => setPlan({ ...plan, expiresAt: e.target.value })} data-testid="admin-expiry" />
              </label>
              <button type="button" className={btn} disabled={busy} data-testid="admin-set-plan"
                onClick={() => void act({ action: "set_plan", planId: plan.planId, expiresAt: plan.planId === "free" || !plan.expiresAt ? null : new Date(`${plan.expiresAt}T23:59:59-03:00`).toISOString() })}>
                Aplicar plano
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <label className="text-tiny text-fg-muted">Coins (+/−)
                <input inputMode="numeric" className={`${field} mt-1 block w-24`} value={coins.delta} onChange={(e) => setCoins({ ...coins, delta: e.target.value })} data-testid="admin-coins" />
              </label>
              <label className="text-tiny text-fg-muted">Motivo
                <input className={`${field} mt-1 block`} value={coins.note} maxLength={200} onChange={(e) => setCoins({ ...coins, note: e.target.value })} />
              </label>
              <button type="button" className={btn} disabled={busy || !Number(coins.delta)} data-testid="admin-apply-coins" onClick={() => void act({ action: "coins", delta: Math.trunc(Number(coins.delta)), note: coins.note })}>
                Ajustar coins
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {u.role !== "admin" && (
                <>
                  <button type="button" className={btn} disabled={busy} data-testid="admin-reset-password" onClick={() => void act({ action: "reset_password" })}>Gerar senha provisória</button>
                  <button type="button" className={`${btn} ${u.disabledAt ? "" : "text-neg"}`} disabled={busy} data-testid="admin-disable" onClick={() => void act({ action: "disable", disabled: !u.disabledAt })}>
                    {u.disabledAt ? "Reativar conta" : "Desativar conta"}
                  </button>
                </>
              )}
            </div>
            {otp && (
              <p className="rounded-control border border-warn bg-warn-tint px-3 py-2 text-warn" data-testid="admin-otp">
                Senha provisória (mostrada só agora): <code className="nums select-all text-fg">{otp}</code>. O usuário será pedido para trocá-la ao entrar; todas as sessões dele foram encerradas.
              </p>
            )}
            {msg && <p className="text-pos" role="status">{msg}</p>}

            <div>
              <p className="text-label u-label text-fg-dim">Pagamentos</p>
              {detail.payments.length ? (
                <ul className="mt-1 divide-y divide-line">
                  {detail.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap gap-x-3 py-1 text-tiny">
                      <span className="text-fg">{p.kind}:{p.reference}{p.period ? `/${p.period}` : ""}</span>
                      <span className="nums">{formatMoney(p.amount, "pt")}</span>
                      <span className={p.status === "approved" ? "text-pos" : "text-fg-muted"}>{p.status}</span>
                      <span className="text-fg-dim">{dt(p.createdAt)}</span>
                      {p.providerPaymentId && <span className="nums text-fg-dim">MP {p.providerPaymentId}</span>}
                    </li>
                  ))}
                </ul>
              ) : <Empty>Nenhum pagamento.</Empty>}
            </div>
            <div>
              <p className="text-label u-label text-fg-dim">Coins</p>
              <ul className="mt-1 max-h-48 divide-y divide-line overflow-y-auto">
                {detail.coinHistory.map((c) => (
                  <li key={c.id} className="flex gap-3 py-1 text-tiny"><span className={`nums w-12 ${c.delta > 0 ? "text-pos" : "text-neg"}`}>{c.delta}</span><span className="text-fg-muted">{c.reason}</span><span className="ml-auto text-fg-dim">{dt(c.createdAt)}</span></li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <Empty>Escolha um usuário para ver plano, coins e pagamentos.</Empty>
        )}
      </div>
    </Panel>
  );
}
