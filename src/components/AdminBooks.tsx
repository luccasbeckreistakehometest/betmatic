"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Empty, Input, Panel, Table, Td, Th, Tr, type Tone } from "@/components/ui";
import { formatNumber } from "@/lib/format";

interface AdapterRow { id: string; book: string; platform: string; enabled: number | null; active: boolean; coverage: string; sports: string[]; lastRunAt: string | null; lastOkAt: string | null; lastStatus: string; lastMs: number; lastRows: number; lastEvents: number; lastMatched: number; lastError: string }
interface Unmatched { key: string; book: string; sportKey: string | null; home: string; away: string; startsAt: string; league: string | null; externalIds: Record<string, string>; prices: number }
interface Coverage { gameId: string; sportKey: string | null; startsAt: string; books: string[]; prices: number; props: number }
interface Payload {
  stats: { events: number; matched: number; unmatched: number; prices: number; props: number; lastSeenAt: string | null };
  adapters: AdapterRow[]; coverage: Coverage[]; unmatched: Unmatched[]; skipped: { book: string; reason: string }[];
  config: { dispersionPct: number; horizonHours: number; adapterTimeoutMs: number };
}

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—");
const STATUS_TONE: Record<string, Tone> = { ok: "pos", empty: "neutral", error: "neg", wall: "warn", timeout: "warn", robots: "warn", off: "neutral", idle: "neutral" };

/**
 * Casas brasileiras: each adapter's last read (rows, matched fixtures, the error when there was
 * one), the on/off switch that overrides BR_BOOKS, the fixtures the matcher could not tie to an
 * ESPN game — fixed by hand with the game id — and the books left out, with the reason.
 */
export function AdminBooks() {
  const [data, setData] = useState<Payload | null>(null);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState("");
  const [assign, setAssign] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/books", { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, []);
  useEffect(() => { void (async () => { await Promise.resolve(); await load(); })(); }, [load]);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch("/api/admin/books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, j };
  }, []);

  async function run() {
    setRunning(true);
    setNote("");
    try {
      const { j } = await post({ action: "run" });
      setNote(`${j.status ?? "erro"}: ${formatNumber(j.rows ?? 0, "pt")} linhas, ${j.events ?? 0} eventos (${j.matched ?? 0} casados), ${j.games ?? 0} jogos, ${Math.round((j.ms ?? 0) / 1000)} s. ${j.note ?? ""}`);
      await load();
    } finally {
      setRunning(false);
    }
  }

  const stats = data?.stats;
  return (
    <Panel
      title="Casas brasileiras"
      meta={stats ? `${stats.matched}/${stats.events} eventos casados · ${formatNumber(stats.prices, "pt")} preços (${formatNumber(stats.props, "pt")} props) · ${dt(stats.lastSeenAt)}` : undefined}
      action={<Button variant="primary" onClick={() => void run()} loading={running} data-testid="books-run">Ler agora</Button>}
      flush
    >
      <div data-testid="admin-books">
        {note && <p className="px-(--cell-px) py-2 text-tiny text-fg-muted" data-testid="books-note">{note}</p>}
        <Table caption="Adaptadores das casas">
          <thead>
            <tr><Th>Casa</Th><Th>Status</Th><Th>Última leitura</Th><Th numeric>Linhas</Th><Th numeric>Eventos</Th><Th numeric>Casados</Th><Th numeric>ms</Th><Th>Erro</Th><Th>Ativa</Th></tr>
          </thead>
          <tbody>
            {(data?.adapters ?? []).map((a) => (
              <Tr key={a.id} tone={a.lastStatus === "error" ? "neg" : undefined} data-testid={`book-${a.id}`}>
                <Td label="Casa"><span className="text-fg">{a.book}</span> <span className="text-micro text-fg-dim">{a.id}</span><p className="text-micro text-fg-dim">{a.coverage}</p></Td>
                <Td label="Status"><Badge tone={STATUS_TONE[a.lastStatus] ?? "neutral"}>{a.lastStatus}</Badge></Td>
                <Td label="Última leitura" className="nums text-fg-muted">{dt(a.lastRunAt)}</Td>
                <Td numeric label="Linhas">{formatNumber(a.lastRows, "pt")}</Td>
                <Td numeric label="Eventos">{a.lastEvents}</Td>
                <Td numeric label="Casados">{a.lastMatched}</Td>
                <Td numeric label="ms">{formatNumber(a.lastMs, "pt")}</Td>
                <Td label="Erro" className="max-w-[260px] truncate text-tiny text-fg-dim" title={a.lastError}>{a.lastError || "—"}</Td>
                <Td label="Ativa">
                  <Button variant={a.active ? "secondary" : "ghost"} className="h-6 px-2 text-label" onClick={() => void post({ action: "toggle", id: a.id, enabled: !a.active }).then(load)} data-testid={`book-toggle-${a.id}`}>
                    {a.active ? "ligada" : "desligada"}{a.enabled === null ? "" : " (manual)"}
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>

        <div className="border-t border-line px-(--cell-px) py-3">
          <h3 className="text-label u-label text-fg-dim">Cobertura por jogo</h3>
          {data?.coverage.length ? (
            <ul className="mt-1 flex flex-col gap-0.5 text-tiny">
              {data.coverage.map((c) => (
                <li key={c.gameId} className="nums text-fg-muted">
                  <span className="text-fg">{c.gameId}</span> {c.sportKey} · {dt(c.startsAt)} · {c.books.length} casas ({c.books.join(", ")}) · {c.prices} preços · {c.props} props
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-tiny text-fg-dim">Nenhum jogo com preços ainda.</p>}
        </div>

        <div className="border-t border-line px-(--cell-px) py-3">
          <h3 className="text-label u-label text-fg-dim">Eventos sem jogo da ESPN</h3>
          <p className="text-micro text-fg-dim">Digite o id do jogo na ESPN para casar à mão; os ids externos do evento passam a casar as outras casas sozinhos.</p>
          {data?.unmatched.length ? (
            <ul className="mt-1 flex flex-col divide-y divide-line" data-testid="books-unmatched">
              {data.unmatched.map((u) => (
                <li key={u.key} className="flex flex-wrap items-center gap-2 py-1.5 text-tiny">
                  <span className="text-fg">{u.home} × {u.away}</span>
                  <span className="nums text-fg-dim">{dt(u.startsAt)} · {u.book} · {u.league ?? u.sportKey} · {u.prices} preços</span>
                  <span className="ml-auto flex items-center gap-1">
                    <Input aria-label="Id do jogo na ESPN" placeholder="gameId" value={assign[u.key] ?? ""} onChange={(e) => setAssign({ ...assign, [u.key]: e.target.value })} className="w-32" />
                    <Button className="h-6 px-2 text-label" onClick={() => void post({ action: "assign", eventKey: u.key, gameId: assign[u.key] ?? "" }).then(load)}>Casar</Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : <Empty rows={0}>Tudo casado.</Empty>}
        </div>

        <details className="border-t border-line px-(--cell-px) py-3">
          <summary className="cursor-pointer text-label u-label text-fg-dim">Casas fora ({data?.skipped.length ?? 0})</summary>
          <ul className="mt-1 flex flex-col gap-0.5 text-tiny text-fg-muted">
            {(data?.skipped ?? []).map((s) => <li key={s.book}><span className="text-fg">{s.book}</span>: {s.reason}</li>)}
          </ul>
          {data?.config && <p className="mt-2 text-micro text-fg-dim">BOOKS_DISPERSION_PCT={data.config.dispersionPct} · BOOKS_HORIZON_HOURS={data.config.horizonHours} · BOOKS_ADAPTER_TIMEOUT_MS={data.config.adapterTimeoutMs}</p>}
        </details>
      </div>
    </Panel>
  );
}
