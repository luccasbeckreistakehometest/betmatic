"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Empty, Panel } from "@/components/ui";
import { PromptPanel } from "@/components/PromptPanel";
import { LearningPanel } from "@/components/LearningPanel";

interface AdminPayload {
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
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="bg-ink-900 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-mist-500">{label}</div>
      <div className="nums text-lg font-semibold text-mist-100">{value}</div>
      {hint && <div className="text-[10px] text-mist-500">{hint}</div>}
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
        <p className="mt-6 text-[14px] text-mist-300">{data.error}</p>
        <Link href="/login" className="mt-4 inline-block text-[13px] text-edge-400 hover:underline">
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
          <span className="rounded border border-warn-400/30 bg-warn-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warn-400">
            admin
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/app" className="text-[12px] text-mist-400 hover:text-mist-100">
            ver o app
          </Link>
          <button
            onClick={() => void refresh()}
            disabled={running}
            className="rounded-lg bg-signal-500 px-3.5 py-1.5 text-[13px] font-medium text-ink-950 transition hover:bg-signal-400 disabled:opacity-50"
          >
            {running ? "Gerando…" : "Rodar refresh agora"}
          </button>
        </div>
      </div>

      {note && <p className="text-[12px] text-signal-400">{note}</p>}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-ink-800 bg-ink-800 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Usuários" value={data?.totals.users ?? 0} />
        <Stat label="Pagantes" value={data?.totals.paying ?? 0} />
        <Stat label="Receita" value={`R$ ${revenueTotal.toFixed(0)}`} />
        <Stat label="Coins gastos" value={data?.totals.coinsSpent ?? 0} />
        <Stat label="Predições" value={data?.predictions.total ?? 0} />
        <Stat label="Tour concluído" value={`${data?.onboarding?.completed ?? 0}/${data?.onboarding?.started ?? 0}`} hint="primeiros acessos" />
        <Stat label="Telegram" value={`${data?.alerts?.linked ?? 0} · ${data?.alerts?.sent ?? 0}`} hint={`contas · enviados · ${data?.alerts?.follows ?? 0} follows`} />
        <Stat label="Por que perdi?" value={data?.reviews?.reviews ?? 0} hint={`$${(data?.reviews?.costUsd ?? 0).toFixed(2)} em revisões`} />
        <Stat
          label="Custo IA"
          value={`$${(data?.predictions.costUsd ?? 0).toFixed(2)}`}
          hint={data?.predictions.latest ? new Date(data.predictions.latest).toLocaleString() : "—"}
        />
      </div>

      <LearningPanel />

      <PromptPanel />

      <Panel title="Execuções do job">
        {data?.jobs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-ink-800 text-[10px] uppercase tracking-wider text-mist-500">
                  <th className="px-2 pb-1.5 font-medium">Início</th>
                  <th className="px-2 pb-1.5 font-medium">Status</th>
                  <th className="px-2 pb-1.5 text-right font-medium">Jogos</th>
                  <th className="px-2 pb-1.5 text-right font-medium">Predições</th>
                  <th className="px-2 pb-1.5 text-right font-medium">Custo</th>
                  <th className="px-2 pb-1.5 font-medium">Nota</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800/70">
                {data.jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="nums px-2 py-1.5 text-mist-300">{new Date(job.startedAt).toLocaleString()}</td>
                    <td className={`px-2 py-1.5 ${job.status === "ok" ? "text-edge-400" : job.status === "error" ? "text-alert-400" : "text-signal-400"}`}>
                      {job.status}
                    </td>
                    <td className="nums px-2 py-1.5 text-right text-mist-200">{job.gamesProcessed}</td>
                    <td className="nums px-2 py-1.5 text-right text-mist-200">{job.predictionsWritten}</td>
                    <td className="nums px-2 py-1.5 text-right text-mist-200">${job.costUsd.toFixed(3)}</td>
                    <td className="max-w-[280px] truncate px-2 py-1.5 text-[11px] text-mist-500" title={job.note}>
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

      <Panel title="Usuários" meta={`${data?.users.length ?? 0}`}>
        {data?.users.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-ink-800 text-[10px] uppercase tracking-wider text-mist-500">
                  <th className="px-2 pb-1.5 font-medium">E-mail</th>
                  <th className="px-2 pb-1.5 font-medium">Papel</th>
                  <th className="px-2 pb-1.5 font-medium">Plano</th>
                  <th className="px-2 pb-1.5 text-right font-medium">Coins</th>
                  <th className="px-2 pb-1.5 font-medium">Cadastro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800/70">
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-2 py-1.5 text-mist-100">{u.email}</td>
                    <td className={`px-2 py-1.5 ${u.role === "admin" ? "text-warn-400" : "text-mist-400"}`}>{u.role}</td>
                    <td className="px-2 py-1.5 text-mist-300">{u.planId}</td>
                    <td className="nums px-2 py-1.5 text-right text-mist-200">{u.coins}</td>
                    <td className="nums px-2 py-1.5 text-[11px] text-mist-500">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Nenhum usuário ainda.</Empty>
        )}
      </Panel>
    </div>
  );
}
