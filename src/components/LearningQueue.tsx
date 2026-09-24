"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Panel, Notice } from "@/components/ui";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import type { DiffLine } from "@/lib/diff";

/**
 * The approval queue: the piece that makes the loop something an operator can trust.
 *
 * Three learning runs had finished with nothing applied and `prompt_versions` empty when this was
 * built — the agent was writing good diagnoses nobody read. Now each finding lands here with the
 * four things a decision needs: which game it came from, how many settled tickets hold it up, the
 * EXACT text it would put in the prompt, and what the measurement says. Approving without the diff
 * is stamping, so the diff is not optional and not behind a link.
 */

interface Measurement {
  verdict: "worse" | "reverted" | "ahead" | "tie" | "insufficient";
  note: string;
  before: { decided: number; hitRate: number; brier: number };
  after: { decided: number; hitRate: number; brier: number };
}

interface Proposal {
  id: string;
  gameId: string;
  matchup: string;
  sportKey: string;
  kind: string;
  channel: "prompt" | "code_gate";
  gate: string;
  status: string;
  feedback: string;
  rationale: string;
  reason: string;
  decided: number;
  tickets: number;
  decidedBy: string;
  createdAt: string;
  appliedAt: string | null;
  evidence: { dim?: string; value?: string; scope?: string; legs?: number; hitRate?: number; predicted?: number; qValue?: number };
  diff: { hunks: DiffLine[][]; stats: { added: number; removed: number; same: number } } | null;
  hasEnglish: boolean;
  measurement?: Measurement | null;
}

interface Payload {
  minDecided: number;
  freeze: { frozen: boolean; note: string; version: number; decided: number };
  appliedToday: { id: string; matchup: string } | null;
  active: { id: string | null; version: number };
  queue: Proposal[];
  applied: Proposal[];
  history: Proposal[];
}

const STATUS_LABEL: Record<string, string> = {
  pending: "aguardando você",
  code_gate: "portão de código",
  under_gate: "abaixo do portão de amostra",
  rejected: "recusada",
  applied: "no ar",
  reverted: "revertida sozinha",
  stale: "vencida",
};

const VERDICT_LABEL: Record<Measurement["verdict"], string> = {
  worse: "abaixo da anterior",
  reverted: "revertida",
  ahead: "à frente da anterior",
  tie: "empate dentro do ruído",
  insufficient: "amostra ainda insuficiente",
};

export function LearningQueue() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/proposals", { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, []);
  useEffect(() => { const id = setTimeout(() => void load(), 0); return () => clearTimeout(id); }, [load]);

  async function decide(id: string, action: "approve" | "reject", body: { reason?: string; override?: boolean } = {}) {
    setBusy(id); setNote(null);
    const r = await fetch("/api/admin/proposals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, ...body }),
    });
    const j = await r.json();
    setNote(j.ok
      ? { tone: "ok", text: action === "approve" ? `Aplicada. O que o agente mudou:\n${j.rationale ?? ""}` : "Recusada, com o motivo guardado." }
      : { tone: "err", text: j.error ?? "falhou" });
    setBusy(null); setRejecting(null); setReason("");
    await load();
  }

  async function runNow() {
    setBusy("run"); setNote(null);
    const r = await fetch("/api/cron/refresh?job=learn-game", { method: "POST" });
    const j = await r.json();
    setNote(j.error
      ? { tone: "err", text: j.error }
      : { tone: "ok", text: `${j.games ?? 0} jogo(s) lido(s), ${j.proposals ?? 0} item(ns) na fila, ${j.reverts?.reverted ?? 0} reversão(ões). ${j.note ?? ""}` });
    setBusy(null); await load();
  }

  const pending = data?.queue.filter((p) => p.status === "pending") ?? [];
  const gates = data?.queue.filter((p) => p.status === "code_gate") ?? [];

  return (
    <Panel
      title="Fila de aprendizado"
      meta={data ? `prompt ativo v${formatNumber(data.active.version, "pt")} · ${pending.length} para decidir · ${gates.length} portão(ões) de código` : undefined}
      action={<Button onClick={() => void runNow()} loading={busy === "run"} disabled={busy !== null} data-testid="learn-game-now">Rodar agora</Button>}
    >
      <p className="text-label text-fg-dim">
        Ao fim de cada jogo o agente lê os bilhetes daquele jogo e escreve o que mudaria. Nada entra em produção sem o seu clique:
        você vê o texto exato que iria pro prompt, quantos bilhetes decididos sustentam a proposta, e depois como ela está medida
        contra a versão anterior. Uma versão por dia, no máximo, e uma versão que ficar medida abaixo da anterior volta sozinha.
      </p>

      {data?.freeze.frozen && <div className="mt-3"><Notice tone="warn">{data.freeze.note}</Notice></div>}
      {data?.appliedToday && (
        <div className="mt-3"><Notice tone="info">Já houve uma versão aplicada hoje. O teto é de uma por dia, para o comparador conseguir dizer qual mudança fez o quê.</Notice></div>
      )}
      {note && (
        <p data-testid="queue-note" className={"mt-3 whitespace-pre-wrap rounded-control px-3 py-2 text-tiny " + (note.tone === "ok" ? "border-l-2 border-pos bg-pos-tint text-pos" : "border border-warn bg-warn-tint text-warn")}>
          {note.text}
        </p>
      )}

      <Section title="Para decidir" empty="Nada esperando por você. A fila enche quando um jogo termina de liquidar.">
        {pending.map((p) => (
          <Row key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} minDecided={data?.minDecided ?? 20}>
            {open === p.id && <Diff diff={p.diff} empty="O texto do prompt sairia idêntico: não há o que aprovar." />}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={() => void decide(p.id, "approve")} loading={busy === p.id} disabled={busy !== null} data-testid="proposal-approve">Aprovar e aplicar</Button>
              <Button onClick={() => { setRejecting(rejecting === p.id ? null : p.id); setReason(""); }} disabled={busy !== null} data-testid="proposal-reject">Recusar</Button>
              {data?.freeze.frozen && (
                <Button variant="danger" onClick={() => void decide(p.id, "approve", { override: true })} disabled={busy !== null}>Aprovar mesmo congelada</Button>
              )}
            </div>
            {rejecting === p.id && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Por que não? (essa linha é o que ensina o agente)"
                  data-testid="proposal-reason"
                  className="min-w-0 flex-1 rounded-control border border-line-control bg-surface-0 px-3 py-1.5 text-tiny text-fg"
                />
                <Button variant="danger" onClick={() => void decide(p.id, "reject", { reason })} disabled={busy !== null || reason.trim().length < 4} data-testid="proposal-reject-confirm">Confirmar recusa</Button>
              </div>
            )}
          </Row>
        ))}
      </Section>

      <Section title="Isto é portão de código, não prompt" empty="Nenhum portão pendente.">
        {gates.map((p) => (
          <Row key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} minDecided={data?.minDecided ?? 20}>
            <p className="mt-1 text-tiny text-warn">{p.rationale}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button onClick={() => { setRejecting(rejecting === p.id ? null : p.id); setReason(""); }} disabled={busy !== null}>Dispensar</Button>
              <span className="text-label text-fg-dim">não existe botão de aprovar aqui: isto precisa de implementação, não de clique</span>
            </div>
            {rejecting === p.id && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Por que dispensar?" className="min-w-0 flex-1 rounded-control border border-line-control bg-surface-0 px-3 py-1.5 text-tiny text-fg" />
                <Button variant="danger" onClick={() => void decide(p.id, "reject", { reason })} disabled={busy !== null || reason.trim().length < 4}>Confirmar</Button>
              </div>
            )}
          </Row>
        ))}
      </Section>

      <Section title="No ar" empty="Nenhuma versão do laço está no ar.">
        {(data?.applied ?? []).map((p) => (
          <Row key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} minDecided={data?.minDecided ?? 20}>
            {p.measurement ? (
              <p className="mt-1 text-tiny text-fg-muted" data-testid="proposal-measurement">
                <Badge tone={p.measurement.verdict === "ahead" ? "pos" : p.measurement.verdict === "worse" || p.measurement.verdict === "reverted" ? "neg" : "neutral"}>
                  {VERDICT_LABEL[p.measurement.verdict]}
                </Badge>{" "}
                {p.measurement.note}
              </p>
            ) : (
              <p className="mt-1 text-tiny text-fg-dim">Ainda sem bilhetes gerados sob esta versão.</p>
            )}
            {open === p.id && <Diff diff={p.diff} empty="Esta versão não mudou nenhuma linha do prompt." />}
          </Row>
        ))}
      </Section>

      <Section title="Histórico" empty="Nada recusado, revertido ou vencido ainda.">
        {(data?.history ?? []).map((p) => (
          <Row key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} minDecided={data?.minDecided ?? 20}>
            {p.reason && <p className="mt-1 text-tiny text-fg-muted" data-testid="proposal-reason-text">{p.reason}</p>}
          </Row>
        ))}
      </Section>
    </Panel>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-micro u-label text-fg-dim">{title}</p>
      {rows.length ? <ul className="mt-1 divide-y divide-line">{rows}</ul> : <p className="mt-1 text-tiny text-fg-dim">{empty}</p>}
    </div>
  );
}

/** One proposal, with everything the operator needs before the buttons: origin, sample, evidence. */
function Row({ p, open, onToggle, minDecided, children }: { p: Proposal; open: boolean; onToggle: () => void; minDecided: number; children?: React.ReactNode }) {
  const short = p.decided < minDecided;
  return (
    <li className="py-3 text-tiny" data-testid="proposal-row" data-status={p.status}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone={p.channel === "code_gate" ? "warn" : p.status === "applied" ? "pos" : p.status === "reverted" || p.status === "rejected" ? "neg" : "neutral"}>
          {STATUS_LABEL[p.status] ?? p.status}
        </Badge>
        <span className="text-fg">{p.matchup || p.gameId || "sem jogo"}</span>
        <span className="nums text-fg-muted" data-testid="proposal-sample">
          {formatNumber(p.tickets, "pt")} bilhete(s) do jogo · {formatNumber(p.decided, "pt")} linha(s) decidida(s) por trás
          {short ? ` (portão pede ${formatNumber(minDecided, "pt")})` : ""}
        </span>
        <span className="text-fg-dim">{formatDateTime(p.createdAt, "pt")}</span>
        {p.diff && (
          <button onClick={onToggle} className="ml-auto text-fg-muted hover:text-fg" data-testid="proposal-diff-toggle">
            {open ? "fechar o diff" : `${p.status === "applied" || p.status === "reverted" ? "ver o que mudou" : "ver o diff"} (+${formatNumber(p.diff.stats.added, "pt")} / −${formatNumber(p.diff.stats.removed, "pt")})`}
          </button>
        )}
      </div>
      <p className="mt-1 text-fg">{p.feedback}</p>
      {p.evidence?.dim && (
        <p className="nums mt-1 text-fg-dim">
          fator {p.evidence.dim}={p.evidence.value} ({p.evidence.scope}) — {formatNumber(p.evidence.legs ?? 0, "pt")} linhas, acerto{" "}
          {formatPercent(p.evidence.hitRate ?? 0, "pt", { digits: 0 })} contra {formatPercent(p.evidence.predicted ?? 0, "pt", { digits: 0 })} previsto, q=
          {formatNumber(p.evidence.qValue ?? 0, "pt", { digits: 3 })}
        </p>
      )}
      {p.rationale && p.channel === "prompt" && <p className="mt-1 text-fg-muted">{p.rationale}</p>}
      {children}
    </li>
  );
}

/** The change itself. A hunk gap is drawn, never skipped in silence. */
function Diff({ diff, empty }: { diff: Proposal["diff"]; empty: string }) {
  if (!diff) return null;
  if (!diff.hunks.length) return <p className="mt-2 text-tiny text-fg-dim">{empty}</p>;
  return (
    <div className="mt-2 max-h-[360px] overflow-auto rounded-control border border-line bg-surface-0" data-testid="proposal-diff">
      {diff.hunks.map((hunk, i) => (
        <div key={hunk[0]?.before ?? hunk[0]?.after ?? i}>
          {i > 0 && <p className="border-y border-line bg-surface-1 px-3 py-0.5 text-micro text-fg-dim">trecho sem mudança omitido</p>}
          <pre className="whitespace-pre-wrap px-3 py-1 font-mono text-micro leading-relaxed">
            {hunk.map((line, j) => (
              <span
                key={`${line.op}-${line.before ?? "x"}-${line.after ?? "x"}-${j}`}
                className={
                  "block " + (line.op === "add" ? "bg-pos-tint text-pos" : line.op === "remove" ? "bg-neg-tint text-neg" : "text-fg-muted")
                }
              >
                {line.op === "add" ? "+ " : line.op === "remove" ? "− " : "  "}
                {line.text || " "}
              </span>
            ))}
          </pre>
        </div>
      ))}
    </div>
  );
}
