"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Empty, Panel, Select, Table, Td, Th, Tr } from "@/components/ui";
import { formatNumber, formatPercent, formatStakeUnits } from "@/lib/format";
import { formatOdds } from "@/lib/format";
import type { FactorStat } from "@/lib/ledger/factor-report";
import type { SliceCalibration } from "@/lib/ledger/calibration-input";
import type { Hypothesis } from "@/lib/ledger/hypotheses";
import type { Comparison, StakeArm } from "@/lib/ledger/ab";
import type { FreezeState } from "@/lib/server/prompts";

/**
 * The policy's own instrument panel. Three questions it answers and nothing else:
 *   · which slices of the record actually disagree with the model (and which only look like it);
 *   · what `c` and `σ_p` each slice is being sized with, and whether its wallet is open;
 *   · what the day's list chose — **and what it discarded, with the reason for each discard**.
 */

interface SelectionItem {
  ledgerId: string; rank: number; scope: "pre" | "live"; gameId: string; title: string; bandKey: string;
  oddsDecimal: number; modelProbability: number; calibratedProbability: number; grossEdge: number; shrunkEdge: number;
  units: number; minDecimal: number | null; capped: string; stakePolicy: string; ladderUnits: number;
}

interface Payload {
  day: string; sportKey: string; sports: string[];
  factors: FactorStat[];
  unmapped: { legs: number; examples: string[] };
  calibration: { pre: SliceCalibration; live: SliceCalibration; slices: SliceCalibration[] };
  selection: { mode: string; note: string; candidates: number; updatedAt: string; totals: { units: number; games: number }; skipped: { ledgerId: string; reason: string }[]; items: SelectionItem[] } | null;
  hypotheses: Hypothesis[];
  versions: {
    freeze: FreezeState;
    versions: { id: string; version: number; source: string; createdBy: string; createdAt: string; active: number }[];
    compare: Comparison | null;
  };
  stakeAb: { arms: StakeArm[]; verdict: string };
  minPerArm: number;
}

const HYPOTHESIS_STATUS: Record<string, { label: string; tone?: "pos" | "warn" | "neg" }> = {
  proposed: { label: "proposta" },
  applied: { label: "aplicada", tone: "pos" },
  rejected: { label: "duplicata", tone: "warn" },
  superseded: { label: "substituída", tone: "warn" },
  blocked: { label: "bloqueada", tone: "warn" },
};

const HYPOTHESIS_VERDICT: Record<string, string> = {
  improved: "melhorou", no_change: "sem mudança", worse: "piorou", inconclusive: "amostra insuficiente",
};

const DIRECTION: Record<string, string> = { lower: "confiar menos", raise: "confiar mais", avoid: "evitar", prefer: "preferir" };

/** Three decimals in the reader's locale — a ratio, a factor and a q-value are read side by side. */
const num3 = (x: number) => formatNumber(x, "pt", { digits: 3 });

const REASONS: Record<string, string> = {
  alternative: "alternativa", scope: "fora do escopo", evidence: "evidência < 100", confidence: "confiança baixa",
  legs: "mais de 2 linhas", odds: "odd fora de 1,30–5,00", edge_low: "edge abaixo de 4%", edge_high: "edge acima de 20%",
  shrunk_low: "edge encolhida abaixo de 2%", unmapped_market: "mercado sem chave", game_taken: "o jogo já tem um bilhete",
  player_cap: "jogadora já aparece duas vezes", below_floor: "abaixo do piso de 0,25 u", day_cap: "teto do dia", quota: "fora dos três",
};

export function AdminPolicy() {
  const [data, setData] = useState<Payload | null>(null);
  const [sport, setSport] = useState("");
  const [scope, setScope] = useState("pregame-main");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/policy${sport ? `?sport=${encodeURIComponent(sport)}` : ""}`, { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, [sport]);
  useEffect(() => { const id = setTimeout(() => void load(), 0); return () => clearTimeout(id); }, [load]);

  async function run(job: "attribute" | "today" | "evaluate") {
    setBusy(true); setNote(null);
    const r = await fetch(`/api/cron/refresh?job=${job}&force=1`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    const done = job === "attribute"
      ? `Atribuição: ${j.legs} linhas, ${j.sole} bilhete(s) morto(s) por uma linha só, ${j.factors} fatores, ${j.flagged} acesos.`
      : job === "today"
        ? `Seleção: ${j.items} item(ns) em ${j.sports} esporte(s).`
        : `Verificação: ${j.evaluated} hipótese(s) avaliada(s) — ${j.improved} melhorou, ${j.worse} piorou, ${j.inconclusive} sem amostra.`;
    setNote(j.error ?? done);
    setBusy(false); await load();
  }

  /** A blocked hypothesis contradicts one that is live; only a person decides which of the two wins. */
  async function unblock(id: string) {
    setBusy(true); setNote(null);
    const r = await fetch("/api/admin/policy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unblock", id }) });
    const j = await r.json().catch(() => ({}));
    setNote(j.error ?? "Hipótese desbloqueada: ela volta a poder ser aplicada.");
    setBusy(false); await load();
  }

  const factors = (data?.factors ?? []).filter((f) => f.scope === scope);
  const pct = (x: number) => formatPercent(x, "pt", { digits: 0 });

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Política — fatores"
        meta={data ? `${data.factors.length} fatia(s) com amostra · ${data.factors.filter((f) => f.flagged).length} acesa(s)` : undefined}
        action={
          <>
            <Select aria-label="Escopo" value={scope} onChange={(e) => setScope(e.target.value)} className="w-44">
              <option value="pregame-main">pré-jogo (principal)</option>
              <option value="pregame-alt">pré-jogo (alternativa)</option>
              <option value="live">ao vivo</option>
            </Select>
            <Button onClick={() => void run("attribute")} loading={busy}>Recalcular</Button>
          </>
        }
        flush
      >
        {factors.length ? (
          <Table caption="Fatores medidos">
            <thead>
              <tr><Th>Dimensão</Th><Th>Valor</Th><Th numeric>Linhas</Th><Th numeric>Acerto</Th><Th numeric>Previsto</Th><Th numeric>Diferença</Th><Th>IC 95%</Th><Th numeric>q</Th><Th>Estado</Th></tr>
            </thead>
            <tbody>
              {factors.slice(0, 40).map((f) => (
                <Tr key={f.id}>
                  <Td label="Dimensão">{f.dim}</Td>
                  <Td label="Valor" className="text-fg">{f.value}</Td>
                  <Td numeric label="Linhas">{formatNumber(f.legs, "pt")}</Td>
                  <Td numeric label="Acerto">{pct(f.hitRate)}</Td>
                  <Td numeric label="Previsto">{pct(f.predicted)}</Td>
                  <Td numeric label="Diferença">{formatPercent(f.gap, "pt", { digits: 0, signed: true })}</Td>
                  <Td numeric label="IC 95%">{pct(f.ciLow)} – {pct(f.ciHigh)}</Td>
                  <Td numeric label="q">{num3(f.qValue)}</Td>
                  <Td label="Estado">{f.flagged ? <Badge tone="warn">acende</Badge> : <Badge>amostra curta</Badge>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-(--panel-p)"><Empty rows={3}>Nenhuma fatia atingiu o mínimo de 30 linhas, 3 jogos e 2 dias ainda.</Empty></div>
        )}
      </Panel>

      <Panel title="Política — calibração por fatia" meta="o c e o σ_p que cada fatia está dimensionando (o dia em seleção fica de fora do próprio cálculo)" flush>
        <Table caption="Calibração por fatia">
          <thead>
            <tr><Th>Fatia</Th><Th numeric>Linhas</Th><Th numeric>Razão medida</Th><Th numeric>c</Th><Th numeric>σ_p</Th><Th numeric>Viés</Th><Th>Regime</Th></tr>
          </thead>
          <tbody>
            {[data?.calibration.pre, data?.calibration.live, ...(data?.calibration.slices ?? [])].filter((s): s is SliceCalibration => !!s).slice(0, 24).map((s, i) => (
              <Tr key={`${s.key}-${i}`}>
                <Td label="Fatia" className="text-fg">{s.key}</Td>
                <Td numeric label="Linhas">{formatNumber(s.settled, "pt")}</Td>
                <Td numeric label="Razão medida">{num3(s.measuredRatio)}</Td>
                <Td numeric label="c">{num3(s.factor)}</Td>
                <Td numeric label="σ_p">{num3(s.sigmaP)}</Td>
                <Td numeric label="Viés">{formatPercent(s.gapPoints, "pt", { digits: 1, signed: true })}</Td>
                <Td label="Regime">{s.mode === "carteira" ? <Badge tone="pos">carteira</Badge> : <Badge tone="warn">medição</Badge>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Panel
        title="Política — a lista do dia"
        meta={data?.selection ? `${data.day} · ${data.sportKey} · ${data.selection.candidates} candidato(s) · modo ${data.selection.mode}` : `${data?.day ?? ""} — nenhuma lista arquivada ainda`}
        action={
          <>
            {data && data.sports.length > 1 && (
              <Select aria-label="Esporte" value={sport || data.sportKey} onChange={(e) => setSport(e.target.value)} className="w-36">
                {data.sports.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            )}
            <Button onClick={() => void run("today")} loading={busy}>Remontar</Button>
          </>
        }
        flush
      >
        {data?.selection?.items.length ? (
          <Table caption="A lista do dia">
            <thead>
              <tr><Th numeric>#</Th><Th>Bilhete</Th><Th>Escopo</Th><Th numeric>Odd</Th><Th numeric>Chance</Th><Th numeric>Edge</Th><Th numeric>Encolhida</Th><Th numeric>Unidade</Th><Th numeric>Régua</Th><Th>Teto</Th></tr>
            </thead>
            <tbody>
              {data.selection.items.map((i) => (
                <Tr key={i.ledgerId}>
                  <Td numeric label="#">{i.rank}</Td>
                  <Td label="Bilhete" className="text-fg">{i.title || i.ledgerId}</Td>
                  <Td label="Escopo">{i.scope === "live" ? <Badge tone="warn">ao vivo</Badge> : <Badge>pré-jogo</Badge>}</Td>
                  <Td numeric label="Odd">{formatOdds(i.oddsDecimal, "pt")}</Td>
                  <Td numeric label="Chance">{pct(i.calibratedProbability)}</Td>
                  <Td numeric label="Edge">{formatPercent(i.grossEdge, "pt", { digits: 1 })}</Td>
                  <Td numeric label="Encolhida">{formatPercent(i.shrunkEdge, "pt", { digits: 2 })}</Td>
                  <Td numeric label="Unidade">{formatStakeUnits(i.units, "pt")}</Td>
                  <Td numeric label="Régua">{formatStakeUnits(i.ladderUnits, "pt")}</Td>
                  <Td label="Teto">{i.capped === "none" ? "—" : i.capped}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-(--panel-p)"><Empty rows={3}>Nenhum bilhete passou no corte hoje.</Empty></div>
        )}
      </Panel>

      <Panel title="Política — o que ficou de fora, e por quê" meta={data?.selection ? `${data.selection.skipped.length} descarte(s)` : undefined} flush>
        {data?.selection?.skipped.length ? (
          <Table caption="Descartes">
            <thead><tr><Th>Motivo</Th><Th numeric>Bilhetes</Th><Th>Exemplos</Th></tr></thead>
            <tbody>
              {Object.entries(data.selection.skipped.reduce<Record<string, string[]>>((acc, s) => ({ ...acc, [s.reason]: [...(acc[s.reason] ?? []), s.ledgerId] }), {}))
                .sort((a, b) => b[1].length - a[1].length)
                .map(([reason, ids]) => (
                  <Tr key={reason}>
                    <Td label="Motivo" className="text-fg">{REASONS[reason] ?? reason}</Td>
                    <Td numeric label="Bilhetes">{formatNumber(ids.length, "pt")}</Td>
                    <Td label="Exemplos" className="text-fg-dim">{ids.slice(0, 2).map((id) => id.split(":").slice(-1)[0].slice(0, 46)).join(" · ")}</Td>
                  </Tr>
                ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-(--panel-p)"><Empty rows={2}>Nada descartado — ou nada gerado ainda.</Empty></div>
        )}
      </Panel>

      {!!data?.unmapped.legs && (
        <Panel title="Política — mercados sem chave" meta={`${data.unmapped.legs} linha(s) no balde unmapped — nunca entram na carteira`}>
          <p className="text-tiny text-fg-dim">{data.unmapped.examples.join(" · ") || "—"}</p>
        </Panel>
      )}

      <Panel
        title="Política — hipóteses"
        meta={data ? `${data.hypotheses.length} registrada(s) · ${data.hypotheses.filter((h) => h.status === "applied").length} aplicada(s)` : undefined}
        action={<Button onClick={() => void run("evaluate")} loading={busy}>Reavaliar</Button>}
        flush
      >
        {data?.hypotheses.length ? (
          <Table caption="Hipóteses propostas pelo aprendizado">
            <thead>
              <tr><Th>Fatia</Th><Th>Direção</Th><Th>Regra</Th><Th>Estado</Th><Th>Veredito</Th><Th /></tr>
            </thead>
            <tbody>
              {data.hypotheses.map((h) => (
                <Tr key={h.id}>
                  <Td label="Fatia" className="text-fg">{h.dim}={h.value}{h.bucket ? ` (${h.bucket})` : ""}</Td>
                  <Td label="Direção">{DIRECTION[h.direction] ?? h.direction}</Td>
                  <Td label="Regra" className="text-fg-dim">{h.text || "—"}</Td>
                  <Td label="Estado"><Badge tone={HYPOTHESIS_STATUS[h.status]?.tone}>{HYPOTHESIS_STATUS[h.status]?.label ?? h.status}</Badge></Td>
                  <Td label="Veredito" className="text-fg-dim">{h.verdict ? HYPOTHESIS_VERDICT[h.verdict] ?? h.verdict : "—"}</Td>
                  <Td label="">
                    {h.status === "blocked"
                      ? <Button onClick={() => void unblock(h.id)} loading={busy}>Desbloquear</Button>
                      : h.supersedes ? <span className="text-fg-dim">aponta para {h.supersedes}</span> : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-(--panel-p)"><Empty rows={3}>Nenhuma hipótese ainda. Elas nascem das lições do aprendizado que citam um fator medido.</Empty></div>
        )}
      </Panel>

      <Panel
        title="Política — versões do prompt"
        meta={data?.versions.compare ? `mínimo de ${data.minPerArm} bilhetes decididos por braço` : "sem duas versões para comparar ainda"}
        flush
      >
        <div className="p-(--panel-p) pb-0">
          <p className="text-tiny text-fg-dim">
            {data?.versions.compare?.note ?? "Uma versão só: o antes e o depois começam a existir quando a segunda for aplicada."}
          </p>
          {data?.versions.freeze.frozen && <p className="mt-2 text-tiny text-warn">{data.versions.freeze.note}</p>}
        </div>
        {data?.versions.compare ? (
          <Table caption="Versões comparadas">
            <thead><tr><Th>Versão</Th><Th numeric>Decididos</Th><Th numeric>Acerto</Th><Th numeric>Previsto</Th><Th numeric>Brier</Th><Th numeric>ROI plano</Th></tr></thead>
            <tbody>
              {[data.versions.compare.a, data.versions.compare.b].map((arm) => (
                <Tr key={arm.key}>
                  <Td label="Versão" className="text-fg">{arm.key}</Td>
                  <Td numeric label="Decididos">{formatNumber(arm.decided, "pt")}</Td>
                  <Td numeric label="Acerto">{Number.isFinite(arm.hitRate) ? pct(arm.hitRate) : "—"}</Td>
                  <Td numeric label="Previsto">{Number.isFinite(arm.predicted) ? pct(arm.predicted) : "—"}</Td>
                  <Td numeric label="Brier">{Number.isFinite(arm.brier) ? num3(arm.brier) : "—"}</Td>
                  <Td numeric label="ROI plano">{Number.isFinite(arm.roi) ? formatPercent(arm.roi, "pt", { digits: 1, signed: true }) : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-(--panel-p)"><Empty rows={2}>Histórico de versões ainda curto.</Empty></div>
        )}
      </Panel>

      <Panel title="Política — escada vs fórmula" meta="o A/B do dimensionamento, dia par e dia ímpar" flush>
        <div className="p-(--panel-p) pb-0"><p className="text-tiny text-fg-dim">{data?.stakeAb.verdict ?? "—"}</p></div>
        <Table caption="Escada contra fórmula">
          <thead><tr><Th>Braço</Th><Th numeric>Dias</Th><Th numeric>Decididos</Th><Th numeric>Arriscado</Th><Th numeric>Resultado</Th><Th numeric>Por unidade</Th></tr></thead>
          <tbody>
            {(data?.stakeAb.arms ?? []).map((arm) => (
              <Tr key={arm.key}>
                <Td label="Braço" className="text-fg">{arm.key === "formula" ? "fórmula (¼ Kelly encolhido)" : "régua de faixa"}</Td>
                <Td numeric label="Dias">{formatNumber(arm.days, "pt")}</Td>
                <Td numeric label="Decididos">{formatNumber(arm.bets, "pt")}</Td>
                <Td numeric label="Arriscado">{formatStakeUnits(arm.units, "pt")}</Td>
                <Td numeric label="Resultado">{formatStakeUnits(arm.pnl, "pt")}</Td>
                <Td numeric label="Por unidade">{Number.isFinite(arm.roi) ? formatPercent(arm.roi, "pt", { digits: 1, signed: true }) : "—"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      {note && <p className="text-tiny text-fg-muted">{note}</p>}
    </div>
  );
}
