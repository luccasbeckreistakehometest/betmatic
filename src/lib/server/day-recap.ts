import { getDb, nowIso } from "@/lib/server/db";
import { readLedger } from "@/lib/ledger/store";
import { brasiliaDay } from "@/lib/ledger/proof";
import { ticketMailConfig, sendMail } from "@/lib/server/ticket-mail";
import { logEvent, reportError } from "@/lib/server/ops-log";
import { formatNumber } from "@/lib/format";
import type { LedgerEntry } from "@/lib/types";

/**
 * The night's recap, by mail, once a day. The operator asked not to have to watch anything: the
 * tickets settle by themselves as ESPN publishes the box scores, and when a day is finished this
 * says what it did — pre-game against live, quarter by quarter, with the balance. Sent once per
 * Brasília day, only when that day has nothing left waiting for a box score (or after the cutoff,
 * so a game ESPN never publishes cannot hold the recap for ever).
 */
export const RECAP_CUTOFF_HOUR = 12;

export interface RecapGroup { label: string; decided: number; won: number; hitRate: number; staked: number; returned: number; roi: number }
export interface RecapGame { matchup: string; pre: RecapGroup; live: RecapGroup; quarters: RecapGroup[] }
export interface DayRecap {
  day: string;
  decided: number; won: number; pending: number;
  staked: number; returned: number; roi: number;
  pre: RecapGroup; live: RecapGroup;
  quarters: RecapGroup[];
  games: RecapGame[];
}

const decided = (e: LedgerEntry) => e.outcome === "won" || e.outcome === "lost";
const unit = (e: LedgerEntry) => (e.outcome === "won" ? e.combinedDecimal - 1 : e.outcome === "lost" ? -1 : 0);

function group(label: string, rows: LedgerEntry[]): RecapGroup {
  const d = rows.filter(decided);
  const won = d.filter((e) => e.outcome === "won").length;
  const pnl = d.reduce((a, e) => a + unit(e), 0);
  return { label, decided: d.length, won, hitRate: d.length ? won / d.length : 0, staked: d.length, returned: d.length + pnl, roi: d.length ? pnl / d.length : 0 };
}

const quarterLabel = (p: number | undefined) => (!p ? "ao vivo" : p <= 4 ? `${p}º quarto` : "prorrogação");

/** The day's picture from the ledger. `day` is a Brasília YYYY-MM-DD. */
export function buildDayRecap(day: string, entries: LedgerEntry[] = readLedger()): DayRecap {
  // A ticket belongs to the day its game was played, so a read taken at 01:00 lands with its game.
  const rows = entries.filter((e) => brasiliaDay(e.startsAt ?? e.createdAt) === day && !e.alternativeOf);
  const pre = rows.filter((e) => e.scope !== "live");
  const live = rows.filter((e) => e.scope === "live");
  const all = group("total", rows);
  const periods = [...new Set(live.map((e) => e.period ?? 0))].sort((a, b) => a - b);
  const byGame = new Map<string, LedgerEntry[]>();
  for (const e of rows) byGame.set(e.gameId, [...(byGame.get(e.gameId) ?? []), e]);
  return {
    day,
    decided: all.decided, won: all.won, pending: rows.filter((e) => e.outcome === "pending").length,
    staked: all.staked, returned: all.returned, roi: all.roi,
    pre: group("pré-jogo", pre),
    live: group("ao vivo", live),
    quarters: periods.map((p) => group(quarterLabel(p), live.filter((e) => (e.period ?? 0) === p))),
    games: [...byGame.entries()].map(([, rs]) => ({
      matchup: rs[0].matchup,
      pre: group("pré-jogo", rs.filter((e) => e.scope !== "live")),
      live: group("ao vivo", rs.filter((e) => e.scope === "live")),
      quarters: [...new Set(rs.filter((e) => e.scope === "live").map((e) => e.period ?? 0))].sort((a, b) => a - b)
        .map((p) => group(quarterLabel(p), rs.filter((e) => e.scope === "live" && (e.period ?? 0) === p))),
    })).sort((a, b) => b.pre.decided + b.live.decided - (a.pre.decided + a.live.decided)),
  };
}

const pct = (n: number, signed = false) => `${signed && n > 0 ? "+" : ""}${formatNumber(n * 100, "pt", { digits: 1 })} %`;
const u = (n: number) => `${formatNumber(n, "pt", { digits: 2 })}u`;

/** Subject and body. Pure, so it is unit-tested. */
export function renderDayRecap(r: DayRecap): { subject: string; text: string } {
  const [y, m, d] = r.day.split("-");
  const date = `${d}/${m}/${y}`;
  const head = (g: RecapGroup) => (g.decided ? `${g.won}/${g.decided} · ${u(g.staked)} → ${u(g.returned)} · ROI ${pct(g.roi, true)}` : "nenhum decidido");
  const lines: string[] = [];
  lines.push(`TOTAL DO DIA — ${head({ ...r, label: "", hitRate: 0 })}`);
  if (r.pending) lines.push(`(${r.pending} ainda pendentes)`);
  lines.push("");
  lines.push(`PRÉ-JOGO  ${head(r.pre)}`);
  lines.push(`AO VIVO   ${head(r.live)}`);
  for (const q of r.quarters) lines.push(`  ${q.label.padEnd(14)} ${head(q)}`);
  lines.push("");
  lines.push("POR JOGO");
  for (const g of r.games) {
    lines.push(`— ${g.matchup}`);
    lines.push(`   pré-jogo  ${head(g.pre)}`);
    if (g.live.decided) {
      lines.push(`   ao vivo   ${head(g.live)}`);
      for (const q of g.quarters) if (q.decided) lines.push(`     ${q.label.padEnd(12)} ${head(q)}`);
    }
  }
  lines.push("");
  lines.push("Cada bilhete conta uma unidade. O preço de uma leitura ao vivo é o da tabela de antes do jogo, então o retorno dela é de referência.");
  lines.push("Tudo em https://betmatic.marqa.online/prova");
  return { subject: `[Betmatic] Resumo de ${date} — ${r.won}/${r.decided} · ROI ${pct(r.roi, true)}`, text: `${date}\n\n${lines.join("\n")}\n` };
}

function alreadySent(day: string): boolean {
  const db = getDb();
  db.exec("CREATE TABLE IF NOT EXISTS day_recaps (day TEXT PRIMARY KEY, sentAt TEXT NOT NULL, decided INTEGER NOT NULL)");
  return !!db.prepare("SELECT 1 FROM day_recaps WHERE day = ?").get(day);
}

export interface RecapJobResult { status: "ok" | "skipped" | "error"; day: string; sent: boolean; decided: number; pending: number; note: string }

/**
 * The job. Looks at yesterday (Brasília) and sends its recap once, when nothing of that day is
 * still waiting to be graded — or, past the cutoff hour, with whatever was decided.
 */
export async function runDayRecap(opts: { now?: Date; day?: string } = {}): Promise<RecapJobResult> {
  const now = opts.now ?? new Date();
  const day = opts.day ?? brasiliaDay(new Date(now.getTime() - 24 * 3_600_000).toISOString());
  if (!ticketMailConfig()) return { status: "skipped", day, sent: false, decided: 0, pending: 0, note: "mail não configurado" };
  if (alreadySent(day)) return { status: "skipped", day, sent: false, decided: 0, pending: 0, note: "já enviado" };
  const recap = buildDayRecap(day);
  if (!recap.decided && !recap.pending) return { status: "skipped", day, sent: false, decided: 0, pending: 0, note: "nenhum bilhete nesse dia" };
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(now));
  if (recap.pending && hour < RECAP_CUTOFF_HOUR) {
    return { status: "ok", day, sent: false, decided: recap.decided, pending: recap.pending, note: `aguardando ${recap.pending} bilhetes` };
  }
  try {
    const mail = renderDayRecap(recap);
    await sendMail(mail.subject, mail.text);
    getDb().prepare("INSERT OR REPLACE INTO day_recaps (day, sentAt, decided) VALUES (?,?,?)").run(day, nowIso(), recap.decided);
    logEvent("mail.recap", { day, decided: recap.decided, pending: recap.pending });
    return { status: "ok", day, sent: true, decided: recap.decided, pending: recap.pending, note: "" };
  } catch (error) {
    reportError("mail.recap", error, { day }, "warn");
    return { status: "error", day, sent: false, decided: recap.decided, pending: recap.pending, note: error instanceof Error ? error.message : String(error) };
  }
}
