"use client";
import { formatUsd } from "@/lib/format";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Empty, KPI, PageHead, Panel, Table, Td, Th, Tr, buttonClass } from "@/components/ui";
import { formatMoney, formatNumber } from "@/lib/format";
import { PromptPanel } from "@/components/PromptPanel";
import { LearningPanel } from "@/components/LearningPanel";
import { AdminPolicy } from "@/components/AdminPolicy";
import { AdminUsers } from "@/components/AdminUsers";
import { AdminHealth, AdminInbox, AdminPayments, type OpsPayload } from "@/components/AdminOps";
import { AdminFeatured } from "@/components/AdminFeatured";
import { AdminBooks } from "@/components/AdminBooks";
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

/** USD is the model's bill, BRL is the business. They never share a group (§11.2). */
const usd = (n: number, digits = 2) => formatUsd(n, "pt", { digits });

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
          : `${result.games} jogos, ${result.predictions} predições, $${usd(result.costUsd ?? 0)}. ${result.note ?? ""}`,
      );
      await load();
    } finally {
      setRunning(false);
    }
  }, [load]);

  if (data?.error) {
    return (
      <div className="mx-auto w-full max-w-lg px-5 py-24 text-center">
        <Logo size={32} />
        <p className="mt-6 text-base text-fg-muted">{data.error}</p>
        <Link href="/login" className="mt-4 inline-block text-sm text-fg underline underline-offset-2">
          Entrar como admin
        </Link>
      </div>
    );
  }

  const revenueTotal = (data?.revenue ?? []).reduce((acc, r) => acc + r.total, 0);

  return (
    // w-full matters: as a flex item of the body with auto side margins, this column would otherwise
    // shrink to fit its content, and one wide table would set the width of the whole page.
    <div className="mx-auto flex w-full max-w-shell flex-col gap-5 px-4 py-6 sm:px-6">
      <PageHead
        kicker="Operação"
        title={<span className="flex items-center gap-3"><Logo size={22} /> <span className="text-fg-dim">admin</span></span>}
        actions={<>
          <Link href="/app" className="text-tiny text-fg-muted underline-offset-2 hover:text-fg hover:underline">
            ver o app
          </Link>
          <button
            onClick={() => void refresh()}
            disabled={running}
            className={buttonClass("primary")}
          >
            {running ? "Gerando…" : "Rodar refresh agora"}
          </button>
        </>}
      />

      {note && <p className="text-tiny text-fg-muted">{note}</p>}

      {/* Two groups, because they are two things: the business in reais, the model's bill in
          dollars. A grid whose last row has a hole is a grid with the wrong column count. */}
      <section className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-line pb-5 sm:grid-cols-3 lg:grid-cols-5">
        <KPI label="Usuários" value={formatNumber(data?.totals.users ?? 0, "pt")} />
        <KPI label="Pagantes" value={formatNumber(data?.totals.paying ?? 0, "pt")} />
        <KPI label="Receita" value={formatMoney(revenueTotal, "pt", { digits: 0 })} />
        <KPI label="Coins gastos" value={formatNumber(data?.totals.coinsSpent ?? 0, "pt")} />
        <KPI label="Predições" value={formatNumber(data?.predictions.total ?? 0, "pt")} />
        <KPI label="Tour concluído" value={`${data?.onboarding?.completed ?? 0}/${data?.onboarding?.started ?? 0}`} sub="primeiros acessos" />
        <KPI label="Telegram" value={`${data?.alerts?.linked ?? 0} · ${data?.alerts?.sent ?? 0}`} sub={`contas · enviados · ${data?.alerts?.follows ?? 0} follows`} />
        <KPI label="Por que perdi?" value={formatNumber(data?.reviews?.reviews ?? 0, "pt")} sub="revisões pedidas" />
        <KPI label="Jogo responsável" value={`${data?.responsible?.withLimits ?? 0} · ${data?.responsible?.paused ?? 0}`} sub={`com teto · em pausa · ${data?.responsible?.reminders ?? 0} lembretes`} />
        <KPI label="Contato" value={formatNumber(data?.contact?.open ?? 0, "pt")} sub="mensagens abertas" />
      </section>

      <section className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-line pb-5 sm:grid-cols-3">
        <KPI label="Custo IA (USD)" value={usd(data?.predictions.costUsd ?? 0)} sub={data?.predictions.latest ? new Date(data.predictions.latest).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"} />
        <KPI label="Revisões (USD)" value={usd(data?.reviews?.costUsd ?? 0)} sub="custo das revisões de derrota" />
      </section>

      <AdminHealth data={data} />

      <AdminAcquisition />
      <AdminFeatured />

      <AdminBooks />

      <AdminUsers />

      <AdminInbox />

      <AdminPayments />

      <AdminPolicy />

      <LearningPanel />

      <PromptPanel />

      <Panel title="Execuções do job" flush>
        {data?.jobs.length ? (
          <Table caption="Execuções do job">
            <thead>
              <tr>
                <Th>Início</Th>
                <Th>Status</Th>
                <Th numeric>Jogos</Th>
                <Th numeric>Predições</Th>
                <Th numeric>Custo (USD)</Th>
                <Th>Nota</Th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((job) => (
                <Tr key={job.id} tone={job.status === "error" ? "neg" : undefined}>
                  <Td numeric label="Início" className="text-fg-muted">{new Date(job.startedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</Td>
                  <Td label="Status" className={job.status === "ok" ? "text-pos" : job.status === "error" ? "text-neg" : "text-fg-muted"}>{job.status}</Td>
                  <Td numeric label="Jogos">{job.gamesProcessed}</Td>
                  <Td numeric label="Predições">{job.predictionsWritten}</Td>
                  <Td numeric label="Custo (USD)">{usd(job.costUsd, 3)}</Td>
                  <Td label="Nota" className="max-w-[280px] truncate text-tiny text-fg-dim" title={job.note}>{job.note || "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>Nenhuma execução ainda.</Empty>
        )}
      </Panel>


    </div>
  );
}
