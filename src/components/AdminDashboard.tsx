"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Empty, Panel } from "@/components/ui";
import { PromptPanel } from "@/components/PromptPanel";
import { LearningPanel } from "@/components/LearningPanel";
import { AdminUsers } from "@/components/AdminUsers";
import { AdminHealth, AdminInbox, AdminPayments, type OpsPayload } from "@/components/AdminOps";
import { AdminFeatured } from "@/components/AdminFeatured";
import { AdminAcquisition } from "@/components/AdminAcquisition";

interface AdminPayload extends OpsPayload {
  contact?: Record<string, number>;
  error?: string;
  users: { id: string; email: string; name: string; role: string; planId: string; coins: number; createdAt: string; lastSeenAt: string | null }[];
  totals: { users: number; admins: number; paying: number; coinsSpent: number };
  revenue: { kind: string; n: number; total: number }[];
  byPlan: { planId: string; n: number }[];
  predictions: { total: number; costUsd: number; latest: string | null };
  jobs: { id: string; status: string; startedAt: string; finishedAt: string | null; gamesProcessed: number; predictionsWritten: number; costUsd: number; note: string }[];
  ledger: { total: number; pending: number; settled: number; won: number };
  onboarding?: { started: number; completed: number };
  alerts?: { linked: number; digest: number; follows: number; sent: number; inapp: number };
  reviews?: { reviews: number; costUsd: number };
  responsible?: { withLimits: number; reminders: number; paused: number; everPaused: number; leaderboardOptIn: number };
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="bg-surface-1 px-3 py-2.5">
      <div className="text-micro uppercase tracking-wider text-fg-dim">{label}</div>
      <div className="nums text-lead font-semibold text-fg">{value}</div>
      {hint && <div className="text-micro text-fg-dim">{hint}</div>}
    </div>
  );
}

export function AdminDashboard() {
  const [data, setData] = useState<AdminPayload | null>(null);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin", { cache: "no-store" });
    setData(await response.json());
  }, []);

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      await load();
    })();
  }, [load]);

  const refresh = useCallback(async () => {
    setRunning(true);
    setNote(null);
    try {
      const response = await fetch("/api/cron/refresh", { method: "POST" });
      const result = await response.json();
      setNote(
        result.error
          ? result.error
          : `${result.games} jogos, ${result.predictions} predições, $${(result.costUsd ?? 0).toFixed(2)}. ${result.note ?? ""}`,
      );
      await load();
    } finally {
      setRunning(false);
    }
  }, [load]);

  if (data?.error) {
    return (
      <div className="mx-auto max-w-lg px-5 py-24 text-center">
        <Logo size={32} />
        <p className="mt-6 text-base text-fg-muted">{data.error}</p>
        <Link href="/login" className="mt-4 inline-block text-sm text-pos hover:underline">
          Entrar como admin
        </Link>
      </div>
    );
  }

  const revenueTotal = (data?.revenue ?? []).reduce((acc, r) => acc + r.total, 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Logo size={26} />
          <span className="rounded-control border border-warn bg-warn-tint px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-warn">
            admin
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/app" className="text-tiny text-fg-muted hover:text-fg">
            ver o app
          </Link>
          <button
            onClick={() => void refresh()}
            disabled={running}
            className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap bg-action text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover active:bg-action-active disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-faint"
          >
            {running ? "Gerando…" : "Rodar refresh agora"}
          </button>
        </div>
      </div>

      {note && <p className="text-tiny text-focus">{note}</p>}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-surface-3 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Usuários" value={data?.totals.users ?? 0} />
        <Stat label="Pagantes" value={data?.totals.paying ?? 0} />
        <Stat label="Receita" value={`R$ ${revenueTotal.toFixed(0)}`} />
        <Stat label="Coins gastos" value={data?.totals.coinsSpent ?? 0} />
        <Stat label="Predições" value={data?.predictions.total ?? 0} />
        <Stat label="Tour concluído" value={`${data?.onboarding?.completed ?? 0}/${data?.onboarding?.started ?? 0}`} hint="primeiros acessos" />
        <Stat label="Telegram" value={`${data?.alerts?.linked ?? 0} · ${data?.alerts?.sent ?? 0}`} hint={`contas · enviados · ${data?.alerts?.follows ?? 0} follows`} />
        <Stat label="Por que perdi?" value={data?.reviews?.reviews ?? 0} hint={`$${(data?.reviews?.costUsd ?? 0).toFixed(2)} em revisões`} />
        <Stat label="Jogo responsável" value={`${data?.responsible?.withLimits ?? 0} · ${data?.responsible?.paused ?? 0}`} hint={`com teto · em pausa · ${data?.responsible?.reminders ?? 0} lembretes`} />
        <Stat
          label="Contato"
          value={data?.contact?.open ?? 0}
          hint="mensagens abertas"
        />
        <Stat
          label="Custo IA"
          value={`$${(data?.predictions.costUsd ?? 0).toFixed(2)}`}
          hint={data?.predictions.latest ? new Date(data.predictions.latest).toLocaleString() : "—"}
        />
      </div>

      <AdminHealth data={data} />

      <AdminAcquisition />
      <AdminFeatured />

      <AdminUsers />

      <AdminInbox />

      <AdminPayments />

      <LearningPanel />

      <PromptPanel />

      <Panel title="Execuções do job">
        {data?.jobs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-tiny">
              <thead>
                <tr className="border-b border-line text-micro uppercase tracking-wider text-fg-dim">
                  <th className="px-2 pb-1.5 font-medium">Início</th>
                  <th className="px-2 pb-1.5 font-medium">Status</th>
                  <th className="px-2 pb-1.5 text-right font-medium">Jogos</th>
                  <th className="px-2 pb-1.5 text-right font-medium">Predições</th>
                  <th className="px-2 pb-1.5 text-right font-medium">Custo</th>
                  <th className="px-2 pb-1.5 font-medium">Nota</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {data.jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="nums px-2 py-1.5 text-fg-muted">{new Date(job.startedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                    <td className={`px-2 py-1.5 ${job.status === "ok" ? "text-pos" : job.status === "error" ? "text-neg" : "text-focus"}`}>
                      {job.status}
                    </td>
                    <td className="nums px-2 py-1.5 text-right text-fg">{job.gamesProcessed}</td>
                    <td className="nums px-2 py-1.5 text-right text-fg">{job.predictionsWritten}</td>
                    <td className="nums px-2 py-1.5 text-right text-fg">${job.costUsd.toFixed(3)}</td>
                    <td className="max-w-[280px] truncate px-2 py-1.5 text-label text-fg-dim" title={job.note}>
                      {job.note || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Nenhuma execução ainda.</Empty>
        )}
      </Panel>


    </div>
  );
}
