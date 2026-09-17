"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useNavState } from "@/components/Controls";
import { Empty, Panel } from "@/components/ui";
import { formatDate, formatDateTime, formatMoneyBRL } from "@/lib/format";
import { paymentLabel } from "@/lib/plans";

interface AccountData {
  user: { name: string; email: string; role: string; coins: number; createdAt: string; mustChangePassword: boolean; termsAcceptedAt: string | null };
  plan: { id: string; name: string; storedPlanId: string; period: string; expiresAt: string | null; active: boolean };
  coinHistory: { id: string; delta: number; reason: string; balanceAfter: number; createdAt: string }[];
  payments: { id: string; kind: string; reference: string; period: string | null; amount: number; status: string; createdAt: string }[];
}

const C = {
  pt: {
    title: "Minha conta", signIn: "Entre na sua conta para ver seus dados.", login: "Entrar",
    plan: "Plano", validUntil: "Vale até {date}", expiredOn: "Venceu em {date}", freePlan: "Plano grátis: 1 jogo por dia.", prepaid: "Pré-pago, sem renovação automática.", seePlans: "Ver planos e comprar",
    coins: "Coins", history: "Histórico de coins", noHistory: "Nenhuma movimentação ainda.",
    payments: "Pagamentos", noPayments: "Nenhum pagamento ainda.",
    password: "Trocar senha", current: "Senha atual", next: "Nova senha (mín. 8)", savePassword: "Salvar nova senha", passwordSaved: "Senha trocada. Os outros aparelhos foram desconectados.", mustChange: "Sua senha foi redefinida pelo suporte. Escolha uma nova para continuar com segurança.",
    sessions: "Sessões", sessionsBody: "Saiu de um aparelho que não é seu? Desconecte todos os aparelhos de uma vez — inclusive este.", logoutAll: "Sair de todos os aparelhos",
    privacy: "Seus dados (LGPD)", exportBody: "Baixe uma cópia de tudo o que guardamos sobre você, em JSON.", export: "Baixar meus dados",
    deleteTitle: "Excluir minha conta", deleteBody: "Apaga sua conta, banca, bilhetes salvos, alertas e ajustes. Os registros de pagamento ficam guardados de forma anonimizada, porque a lei exige para fins fiscais. Não dá para desfazer.", deletePassword: "Confirme com sua senha", deleteConfirm: "Entendi que isso não pode ser desfeito.", deleteButton: "Excluir definitivamente",
    responsible: "Jogo responsável", responsibleBody: "Limites de aposta, lembrete de tempo, aviso de sequência e pausa de 7 ou 30 dias.", responsibleLink: "Abrir ajustes",
    help: "Precisa de ajuda com a conta ou um pagamento?", contact: "Fale com a gente",
    member: "Conta criada em {date}", consent: "Termos aceitos em {date}",
    reasons: { purchase: "Compra de coins", plan: "Coins do plano", spend: "Análise de bilhete", refund: "Estorno de análise", referral: "Indicação", reversal: "Estorno de pagamento", admin: "Ajuste do suporte" } as Record<string, string>,
    status: { pending: "aguardando", approved: "aprovado", rejected: "recusado", refunded: "estornado", charged_back: "contestado" } as Record<string, string>,
  },
  en: {
    title: "My account", signIn: "Log in to see your account.", login: "Log in",
    plan: "Plan", validUntil: "Valid until {date}", expiredOn: "Ended on {date}", freePlan: "Free plan: 1 game a day.", prepaid: "Prepaid, no auto-renewal.", seePlans: "See plans and buy",
    coins: "Coins", history: "Coin history", noHistory: "No activity yet.",
    payments: "Payments", noPayments: "No payments yet.",
    password: "Change password", current: "Current password", next: "New password (min. 8)", savePassword: "Save new password", passwordSaved: "Password changed. Your other devices were signed out.", mustChange: "Support reset your password. Choose a new one to stay secure.",
    sessions: "Sessions", sessionsBody: "Signed in on a device that isn't yours? Sign out of every device at once — this one included.", logoutAll: "Sign out of all devices",
    privacy: "Your data (LGPD)", exportBody: "Download a copy of everything we store about you, as JSON.", export: "Download my data",
    deleteTitle: "Delete my account", deleteBody: "Deletes your account, bankroll, saved tickets, alerts and settings. Payment records are kept anonymised because tax law requires it. This cannot be undone.", deletePassword: "Confirm with your password", deleteConfirm: "I understand this cannot be undone.", deleteButton: "Delete permanently",
    responsible: "Responsible play", responsibleBody: "Stake limits, a time reminder, a losing-streak notice and a 7- or 30-day pause.", responsibleLink: "Open settings",
    help: "Need help with your account or a payment?", contact: "Contact us",
    member: "Member since {date}", consent: "Terms accepted on {date}",
    reasons: { purchase: "Coin purchase", plan: "Plan coins", spend: "Slip analysis", refund: "Analysis refund", referral: "Referral", reversal: "Payment reversal", admin: "Support adjustment" } as Record<string, string>,
    status: { pending: "waiting", approved: "approved", rejected: "declined", refunded: "refunded", charged_back: "charged back" } as Record<string, string>,
  },
};

const field = "w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[14px] text-mist-100 outline-none focus:border-edge-400";
const button = "rounded-lg border border-ink-700 px-3.5 py-1.5 text-[13px] text-mist-200 transition hover:border-ink-600 hover:text-white disabled:opacity-50";

export function AccountPanel() {
  const { lang } = useNavState();
  const c = C[lang];
  const router = useRouter();
  const search = useSearchParams();
  const [data, setData] = useState<AccountData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "anon">("loading");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [del, setDel] = useState({ password: "", confirm: false });
  const [delMsg, setDelMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/account?lang=${lang}`, { cache: "no-store" }).catch(() => null);
    if (r?.ok) { setData(await r.json()); setState("ready"); } else setState("anon");
  }, [lang]);

  useEffect(() => {
    void (async () => { await Promise.resolve(); await load(); })();
  }, [load]);

  async function post(url: string, body: unknown) {
    const r = await fetch(`${url}?lang=${lang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, json: await r.json().catch(() => ({})) };
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy("pw");
    const r = await post("/api/account/password", pw).catch(() => ({ ok: false, json: {} as Record<string, string> }));
    setPwMsg({ ok: r.ok, text: r.ok ? c.passwordSaved : r.json.message ?? "—" });
    if (r.ok) { setPw({ current: "", next: "" }); await load(); }
    setBusy(null);
  }

  async function logoutAll() {
    setBusy("all");
    await post("/api/auth/logout", { everywhere: true }).catch(() => null);
    router.replace(`/login?lang=${lang}`);
    router.refresh();
  }

  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault();
    setBusy("del");
    const r = await post("/api/account/delete", { password: del.password, confirm: del.confirm ? true : undefined }).catch(() => ({ ok: false, json: {} as Record<string, string> }));
    if (r.ok) { router.replace(`/?lang=${lang}&conta=excluida`); router.refresh(); return; }
    setDelMsg(r.json.message ?? "—");
    setBusy(null);
  }

  if (state === "loading") return <div className="h-40 animate-pulse rounded-xl bg-ink-900" />;
  if (state === "anon" || !data) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold text-white">{c.title}</h1>
        <Empty>{c.signIn}</Empty>
        <Link href={`/login?lang=${lang}&next=${encodeURIComponent(`/app/conta?lang=${lang}`)}`} className="w-fit rounded-lg bg-edge-400 px-3.5 py-1.5 text-[13px] font-semibold text-ink-950">{c.login}</Link>
      </div>
    );
  }

  const { user, plan } = data;
  const reason = (r: string) => c.reasons[r.split(":")[0]] ?? r;
  const mustChange = user.mustChangePassword || search.get("trocar") === "1";

  return (
    <div className="flex flex-col gap-5" data-testid="account-page">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white">{c.title}</h1>
        <p className="mt-1 text-sm text-mist-400">{user.name} · {user.email}</p>
        <p className="mt-0.5 text-[12px] text-mist-500">
          {c.member.replace("{date}", formatDate(user.createdAt, lang, { year: true }))}
          {user.termsAcceptedAt ? ` · ${c.consent.replace("{date}", formatDate(user.termsAcceptedAt, lang, { year: true }))}` : ""}
        </p>
      </div>

      {mustChange && <p className="rounded-lg border border-warn-400/30 bg-warn-400/5 px-3 py-2 text-[13px] text-warn-400" role="alert">{c.mustChange}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title={c.plan} lang={lang}>
          <p className="text-[18px] font-semibold text-white" data-testid="account-plan">{plan.name}</p>
          {plan.storedPlanId !== "free" && plan.expiresAt ? (
            <p className={`mt-1 text-[13px] ${plan.active ? "text-mist-300" : "text-warn-400"}`} data-testid="account-expiry">
              {(plan.active ? c.validUntil : c.expiredOn).replace("{date}", formatDate(plan.expiresAt, lang, { year: true }))} · {c.prepaid}
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-mist-400">{c.freePlan}</p>
          )}
          <Link href={`/planos?lang=${lang}`} className="mt-3 inline-block rounded-lg bg-edge-400 px-3.5 py-1.5 text-[13px] font-semibold text-ink-950 hover:bg-edge-500">{c.seePlans}</Link>
        </Panel>
        <Panel title={c.coins} lang={lang}>
          <p className="nums text-[18px] font-semibold text-white" data-testid="account-coins">{user.coins}</p>
          <p className="mt-1 text-[13px] text-mist-400">{lang === "pt" ? "8 coins por análise de bilhete." : "8 coins per slip analysis."}</p>
        </Panel>
      </div>

      <Panel title={c.history} lang={lang}>
        {data.coinHistory.length ? (
          <ul className="divide-y divide-ink-800 text-[13px]" data-testid="coin-history">
            {data.coinHistory.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                <span className={`nums w-12 font-semibold ${row.delta >= 0 ? "text-edge-400" : "text-alert-400"}`}>{row.delta > 0 ? `+${row.delta}` : row.delta}</span>
                <span className="text-mist-200">{reason(row.reason)}</span>
                <span className="ml-auto text-[12px] text-mist-500">{formatDateTime(row.createdAt, lang)} · <span className="nums">{row.balanceAfter}</span></span>
              </li>
            ))}
          </ul>
        ) : <Empty>{c.noHistory}</Empty>}
      </Panel>

      <Panel title={c.payments} lang={lang}>
        {data.payments.length ? (
          <ul className="divide-y divide-ink-800 text-[13px]" data-testid="payments-list">
            {data.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                <span className="text-mist-200">{paymentLabel(p, lang)}</span>
                <span className="nums text-mist-300">{formatMoneyBRL(p.amount, lang, 2)}</span>
                <span className="text-mist-400">{c.status[p.status] ?? p.status}</span>
                <span className="ml-auto text-[12px] text-mist-500">{formatDateTime(p.createdAt, lang)}</span>
              </li>
            ))}
          </ul>
        ) : <Empty>{c.noPayments}</Empty>}
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title={c.password} lang={lang}>
          <form onSubmit={changePassword} className="flex flex-col gap-2.5" data-testid="password-form">
            <label className="flex flex-col gap-1 text-[12px] text-mist-400">{c.current}
              <input type="password" className={field} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required autoComplete="current-password" data-testid="pw-current" />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-mist-400">{c.next}
              <input type="password" className={field} value={pw.next} minLength={8} onChange={(e) => setPw({ ...pw, next: e.target.value })} required autoComplete="new-password" data-testid="pw-next" />
            </label>
            <button type="submit" disabled={busy === "pw"} className={`${button} w-fit`} data-testid="pw-save">{c.savePassword}</button>
            {pwMsg && <p className={`text-[12.5px] ${pwMsg.ok ? "text-edge-400" : "text-alert-400"}`} role="status" data-testid="pw-msg">{pwMsg.text}</p>}
          </form>
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title={c.sessions} lang={lang}>
            <p className="text-[13px] text-mist-400">{c.sessionsBody}</p>
            <button type="button" onClick={() => void logoutAll()} disabled={busy === "all"} className={`${button} mt-3`} data-testid="logout-all">{c.logoutAll}</button>
          </Panel>
          <Panel title={c.responsible} lang={lang}>
            <p className="text-[13px] text-mist-400">{c.responsibleBody}</p>
            <div className="mt-3 flex flex-wrap gap-3 text-[13px]">
              <Link href={`/app/settings?lang=${lang}`} className="text-edge-400 hover:underline">{c.responsibleLink}</Link>
              <Link href={lang === "pt" ? "/jogo-responsavel" : "/responsible-gambling"} className="text-mist-300 hover:underline">{lang === "pt" ? "Onde buscar ajuda" : "Where to get help"}</Link>
            </div>
          </Panel>
        </div>
      </div>

      <Panel title={c.privacy} lang={lang}>
        <p className="text-[13px] text-mist-400">{c.exportBody}</p>
        <a href={`/api/account/export?lang=${lang}`} className={`${button} mt-3 inline-block`} data-testid="export-data">{c.export}</a>
        {user.role !== "admin" && (
          <form onSubmit={deleteAccount} className="mt-6 flex flex-col gap-2.5 border-t border-ink-800 pt-4" data-testid="delete-form">
            <p className="text-[14px] font-semibold text-alert-400">{c.deleteTitle}</p>
            <p className="text-[13px] text-mist-400">{c.deleteBody}</p>
            <label className="flex max-w-sm flex-col gap-1 text-[12px] text-mist-400">{c.deletePassword}
              <input type="password" className={field} value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} required autoComplete="current-password" data-testid="delete-password" />
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-mist-300">
              <input type="checkbox" checked={del.confirm} onChange={(e) => setDel({ ...del, confirm: e.target.checked })} required className="size-4 accent-alert-400" data-testid="delete-confirm" />
              {c.deleteConfirm}
            </label>
            <button type="submit" disabled={busy === "del" || !del.confirm} className="w-fit rounded-lg border border-alert-400/50 px-3.5 py-1.5 text-[13px] text-alert-400 transition hover:bg-alert-400/10 disabled:opacity-50" data-testid="delete-submit">{c.deleteButton}</button>
            {delMsg && <p className="text-[12.5px] text-alert-400" role="alert">{delMsg}</p>}
          </form>
        )}
      </Panel>

      <p className="text-[13px] text-mist-400">{c.help} <Link href={`/contato?lang=${lang}`} className="text-edge-400 hover:underline">{c.contact}</Link></p>
    </div>
  );
}
