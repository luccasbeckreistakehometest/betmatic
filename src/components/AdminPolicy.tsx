"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Empty, Panel, Select, Table, Td, Th, Tr } from "@/components/ui";
import { formatNumber, formatPercent, formatStakeUnits } from "@/lib/format";
import { formatOdds } from "@/lib/format";
import type { FactorStat } from "@/lib/ledger/factor-report";
import type { SliceCalibration } from "@/lib/ledger/calibration-input";

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
}

/** Three decimals in the reader's locale — a ratio, a factor and a q-value are read side by side. */
const num3 = (x: number) => formatNumber(x, "pt", { digits: 3 });

const REASONS: Record<string, string> = {
  alternative: "alternativa", scope: "fora do escopo", evidence: "evidência < 100", confidence: "confiança baixa",
  legs: "mais de 2 pernas", odds: "odd fora de 1,30–5,00", edge_low: "edge abaixo de 4%", edge_high: "edge acima de 20%",
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

  async function run(job: "attribute" | "today") {
    setBusy(true); setNote(null);
    const r = await fetch(`/api/cron/refresh?job=${job}`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setNote(j.error ?? (job === "attribute" ? `Atribuição: ${j.legs} pernas, ${j.sole} mortes de perna única, ${j.factors} fatores, ${j.flagged} acesos.` : `Seleção: ${j.items} item(ns) em ${j.sports} esporte(s).`));
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
              <tr><Th>Dimensão</Th><Th>Valor</Th><Th numeric>Pernas</Th><Th numeric>Acerto</Th><Th numeric>Previsto</Th><Th numeric>Diferença</Th><Th>IC 95%</Th><Th numeric>q</Th><Th>Estado</Th></tr>
            </thead>
            <tbody>
              {factors.slice(0, 40).map((f) => (
                <Tr key={f.id}>
                  <Td label="Dimensão">{f.dim}</Td>
                  <Td label="Valor" className="text-fg">{f.value}</Td>
                  <Td numeric label="Pernas">{formatNumber(f.legs, "pt")}</Td>
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
          <div className="p-(--panel-p)"><Empty rows={3}>Nenhuma fatia atingiu o mínimo de 30 pernas, 3 jogos e 2 dias ainda.</Empty></div>
        )}
      </Panel>

      <Panel title="Política — calibração por fatia" meta="o c e o σ_p que cada fatia está dimensionando (o dia em seleção fica de fora do próprio cálculo)" flush>
        <Table caption="Calibração por fatia">
          <thead>
            <tr><Th>Fatia</Th><Th numeric>Pernas</Th><Th numeric>Razão medida</Th><Th numeric>c</Th><Th numeric>σ_p</Th><Th numeric>Viés</Th><Th>Regime</Th></tr>
          </thead>
          <tbody>
            {[data?.calibration.pre, data?.calibration.live, ...(data?.calibration.slices ?? [])].filter((s): s is SliceCalibration => !!s).slice(0, 24).map((s, i) => (
              <Tr key={`${s.key}-${i}`}>
                <Td label="Fatia" className="text-fg">{s.key}</Td>
                <Td numeric label="Pernas">{formatNumber(s.settled, "pt")}</Td>
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
        <Panel title="Política — mercados sem chave" meta={`${data.unmapped.legs} perna(s) no balde unmapped — nunca entram na carteira`}>
          <p className="text-tiny text-fg-dim">{data.unmapped.examples.join(" · ") || "—"}</p>
        </Panel>
      )}

      {note && <p className="text-tiny text-fg-muted">{note}</p>}
    </div>
  );
}
