import { getDb, nowIso } from "@/lib/server/db";
import { readLedger } from "@/lib/ledger/store";
import { brasiliaDay } from "@/lib/ledger/day";
import { calibrationSlice, periodLabel, ticketRows, uniqueLegs } from "@/lib/ledger/live-calibration";
import { ticketMailConfig, sendMail } from "@/lib/server/ticket-mail";
import { logEvent, reportError } from "@/lib/server/ops-log";
import { formatNumber } from "@/lib/format";
import type { LedgerEntry } from "@/lib/types";

/**
 * The night's recap, by mail, once a day. The operator asked not to have to watch anything: the
 * tickets settle by themselves as ESPN publishes the box scores, and when a day is finished this
 * says what it did — pre-game against live, quarter by quarter. Sent once per Brasília day, only
 * when that day has nothing left waiting for a box score (or after the cutoff, so a game ESPN never
 * publishes cannot hold the recap for ever).
 *
 * The money in it is PRE-GAME money and nothing else. A live read carries the pre-game price, which
 * no book is still offering in the third quarter, so the old "TOTAL DO DIA" added a real loss to an
 * uncollectable win and printed +243.6% on a night that landed 12.5 reads below its own promise.
 * The live block says how often the reads landed against the chance they gave, and no units.
 */
export const RECAP_CUTOFF_HOUR = 12;

/** Pre-game only: it is the only scope with a price anybody could have taken. */
export interface RecapGroup { label: string; decided: number; won: number; hitRate: number; staked: number; returned: number; roi: number }

/** A live slice: what it promised, what it delivered, and the band. No units anywhere. */
export interface RecapCalibration {
  label: string;
  decided: number; won: number; hitRate: number;
  predictedAverage: number; expectedWins: number;
  lo: number; hi: number;
  gapPoints: number;
  verdict: "abaixo" | "dentro" | "acima";
}

export interface RecapGame { matchup: string; pre: RecapGroup; live: RecapCalibration; quarters: RecapCalibration[] }
export interface DayRecap {
  day: string;
  /** Pre-game counts: the ones the balance is made of. */
  decided: number; won: number; pending: number;
  staked: number; returned: number; roi: number;
  pre: RecapGroup;
  live: RecapCalibration;
  quarters: RecapCalibration[];
  /** Decided live legs in the day, and how many carried a computed chance. */
  liveCoverage: { legsDecided: number; withComputed: number };
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

const quarterLabel = (p: number | undefined) => (!p ? "ao vivo" : periodLabel(p));

/** One live slice, measured against the chance it gave. The reads are tickets, not legs, here. */
function calibrate(label: string, rows: LedgerEntry[]): RecapCalibration {
  const s = calibrationSlice(label, label, ticketRows(rows));
  return {
    label, decided: s.n, won: s.won, hitRate: s.hitRate,
    predictedAverage: s.predictedAverage, expectedWins: s.expectedWins,
    lo: s.lo, hi: s.hi, gapPoints: s.gapPoints, verdict: s.verdict,
  };
}

/** The day's picture from the ledger. `day` is a Brasília YYYY-MM-DD. */
export function buildDayRecap(day: string, entries: LedgerEntry[] = readLedger()): DayRecap {
  // A ticket belongs to the day its game was played, so a read taken at 01:00 lands with its game.
  const rows = entries.filter((e) => brasiliaDay(e.startsAt ?? e.createdAt) === day && !e.alternativeOf);
  const pre = rows.filter((e) => e.scope !== "live");
  const live = rows.filter((e) => e.scope === "live");
  const money = group("pré-jogo", pre);
  const periods = [...new Set(live.map((e) => e.period ?? 0))].sort((a, b) => a - b);
  const coverage = uniqueLegs(live);
  const byGame = new Map<string, LedgerEntry[]>();
  for (const e of rows) byGame.set(e.gameId, [...(byGame.get(e.gameId) ?? []), e]);
  return {
    day,
    decided: money.decided, won: money.won, pending: rows.filter((e) => e.outcome === "pending").length,
    staked: money.staked, returned: money.returned, roi: money.roi,
    pre: money,
    live: calibrate("ao vivo", live),
    quarters: periods.map((p) => calibrate(quarterLabel(p), live.filter((e) => (e.period ?? 0) === p))),
    liveCoverage: { legsDecided: coverage.legsDecided, withComputed: coverage.rows.length },
    games: [...byGame.entries()].map(([, rs]) => ({
      matchup: rs[0].matchup,
      pre: group("pré-jogo", rs.filter((e) => e.scope !== "live")),
      live: calibrate("ao vivo", rs.filter((e) => e.scope === "live")),
      quarters: [...new Set(rs.filter((e) => e.scope === "live").map((e) => e.period ?? 0))].sort((a, b) => a - b)
        .map((p) => calibrate(quarterLabel(p), rs.filter((e) => e.scope === "live" && (e.period ?? 0) === p))),
    })).sort((a, b) => b.pre.decided + b.live.decided - (a.pre.decided + a.live.decided)),
  };
}

const pct = (n: number, signed = false) => `${signed && n > 0 ? "+" : ""}${formatNumber(n * 100, "pt", { digits: 1 })} %`;
const u = (n: number) => `${formatNumber(n, "pt", { digits: 2 })}u`;

const gap = (n: number) => formatNumber(n, "pt", { digits: 1, signed: true });
const points = (n: number) => `${gap(n)} pontos`;
const VERDICT: Record<RecapCalibration["verdict"], string> = { abaixo: "ABAIXO DO ESPERADO", dentro: "DENTRO DO ESPERADO", acima: "ACIMA DO ESPERADO" };

/** Subject and body. Pure, so it is unit-tested. Money is pre-game; the live block carries none. */
export function renderDayRecap(r: DayRecap): { subject: string; text: string } {
  const [y, m, d] = r.day.split("-");
  const date = `${d}/${m}/${y}`;
  const head = (g: RecapGroup) => (g.decided ? `${g.won}/${g.decided} · ${u(g.staked)} → ${u(g.returned)} · ROI ${pct(g.roi, true)}` : "nenhum decidido");
  const one = (n: number) => formatNumber(n, "pt", { digits: 1 });
  const lines: string[] = [];
  lines.push(`PRÉ-JOGO   ${head(r.pre)}`);
  if (r.pending) lines.push(`(${r.pending} ainda pendentes)`);
  lines.push("");
  if (r.live.decided) {
    lines.push(`AO VIVO    ${r.live.won}/${r.live.decided} acertaram (${pct(r.live.hitRate)})`);
    lines.push(`           chance média que demos ${pct(r.live.predictedAverage)} · esperados ${one(r.live.expectedWins)} · faixa [${r.live.lo}-${r.live.hi}]`);
    lines.push(`           desvio ${points(r.live.gapPoints)} — ${VERDICT[r.live.verdict]}`);
    for (const q of r.quarters) {
      if (!q.decided) continue;
      lines.push(`             ${q.label.padEnd(13)}${`${q.won}/${q.decided}`.padEnd(6)}${`(${pct(q.hitRate)})`.padEnd(11)} esperado ${one(q.expectedWins).padStart(4)}  ${gap(q.gapPoints)}p`);
    }
  } else {
    lines.push("AO VIVO    nenhuma leitura decidida");
  }
  lines.push("");
  lines.push("POR JOGO");
  for (const g of r.games) {
    lines.push(`— ${g.matchup}`);
    lines.push(`   pré-jogo  ${head(g.pre)}`);
    if (g.live.decided) {
      lines.push(`   ao vivo   ${g.live.won}/${g.live.decided} (${pct(g.live.hitRate)}) · esperados ${one(g.live.expectedWins)} · desvio ${points(g.live.gapPoints)}`);
      for (const q of g.quarters) if (q.decided) lines.push(`     ${q.label.padEnd(13)}${`${q.won}/${q.decided}`.padEnd(6)}${`(${pct(q.hitRate)})`.padEnd(11)} esperado ${one(q.expectedWins).padStart(4)}  ${gap(q.gapPoints)}p`);
    }
  }
  lines.push("");
  lines.push("Dinheiro é só do pré-jogo. Leitura ao vivo não tem preço coletável: medimos acerto contra a");
  lines.push("chance que demos, não retorno.");
  if (r.liveCoverage.legsDecided > r.liveCoverage.withComputed) {
    lines.push(`(${r.liveCoverage.withComputed} linhas na conta, ${r.liveCoverage.legsDecided - r.liveCoverage.withComputed} fora por falta de chance calculada.)`);
  }
  lines.push("Tudo em https://betmatic.marqa.online/prova");
  const liveSubject = r.live.decided ? ` · ao vivo ${r.live.won}/${r.live.decided} (${gap(r.live.gapPoints)}p)` : "";
  return {
    subject: `[Betmatic] Resumo de ${date} — pré-jogo ${r.pre.won}/${r.pre.decided} · ROI ${pct(r.pre.roi, true)}${liveSubject}`,
    text: `${date}\n\n${lines.join("\n")}\n`,
  };
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
