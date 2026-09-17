import { getDb, newId, nowIso } from "@/lib/server/db";
import { listBankroll } from "@/lib/server/bankroll";
import { readLedger } from "@/lib/ledger/store";
import { deliver } from "@/lib/server/telegram";
import { findById } from "@/lib/server/users";
import { logEvent } from "@/lib/server/ops-log";
import { baseUrlOrEmpty } from "@/lib/base-url";
import { normaliseLang } from "@/lib/i18n";
import { weeklyReport, type DisciplineEntry, type WeeklyPayload } from "@/lib/discipline";

export function disciplineEntries(userId: string): DisciplineEntry[] {
  const ledger = new Map(readLedger().map((e) => [e.id, e]));
  const { entries } = listBankroll(userId);
  const ledgerIds = new Map((getDb().prepare("SELECT id, ledgerId FROM bankroll_entries WHERE userId=?").all(userId) as { id: string; ledgerId: string | null }[]).map((r) => [r.id, r.ledgerId]));
  return entries.map((e) => {
    const l = ledgerIds.get(e.id);
    const ticket = l ? ledger.get(l) : undefined;
    return {
      stake: e.stake, odds: e.combinedDecimal, outcome: e.outcome, createdAt: e.createdAt, settledAt: e.settledAt,
      modelled: ticket?.modelledProbability ?? null,
      clv: e.clv && e.clv.n > 0 && Number.isFinite(e.clv.pct) ? e.clv.pct : null,
    };
  });
}

const bankrollOf = (userId: string) => (getDb().prepare("SELECT bankrollAmount FROM user_settings WHERE userId=?").get(userId) as { bankrollAmount: number | null } | undefined)?.bankrollAmount ?? null;

export const reportFor = (userId: string, now = new Date()): WeeklyPayload => weeklyReport(disciplineEntries(userId), { now, bankroll: bankrollOf(userId) });

export function storedReports(userId: string): WeeklyPayload[] {
  return (getDb().prepare("SELECT payload FROM weekly_reports WHERE userId=? ORDER BY weekKey DESC LIMIT 12").all(userId) as { payload: string }[]).map((r) => JSON.parse(r.payload) as WeeklyPayload);
}

/** Monday from 12:00 UTC on; a manual run can force it. */
export const weeklyDue = (now: Date) => now.getUTCDay() === 1 && now.getUTCHours() >= 12;

function alertText(p: WeeklyPayload, lang: "pt" | "en"): { title: string; body: string } {
  const w = p.windows[0];
  const roi = w.roi === null ? "—" : `${w.roi > 0 ? "+" : ""}${(w.roi * 100).toFixed(1)}%`;
  const chase = p.chasing.length;
  if (lang === "pt") {
    return {
      title: "Seu espelho da semana",
      body: [`Semana: ${p.bets} apostas, retorno nos últimos 7 dias ${roi}.`, chase ? `Você aumentou a aposta logo depois de perder ${chase === 1 ? "1 vez" : `${chase} vezes`}.` : "", "O relatório completo está no app. Se quiser dar um tempo, a pausa fica em Configurações."].filter(Boolean).join(" "),
    };
  }
  return {
    title: "Your week in the mirror",
    body: [`This week: ${p.bets} bets, 7-day return ${roi}.`, chase ? `You raised the stake right after a loss ${chase === 1 ? "once" : `${chase} times`}.` : "", "The full report is in the app. If you want a break, the pause is in Settings."].filter(Boolean).join(" "),
  };
}

/**
 * The weekly job: one report per user with at least three bets in the last seven days, written once
 * per ISO week and announced once (never to a paused user — deliver() skips them; the report is
 * still readable in the app).
 */
export async function runWeeklyReports(opts: { now?: Date; force?: boolean } = {}): Promise<{ status: "ok" | "skipped"; users: number; written: number; notified: number }> {
  const now = opts.now ?? new Date();
  if (!opts.force && !weeklyDue(now)) return { status: "skipped", users: 0, written: 0, notified: 0 };
  const db = getDb();
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const users = db.prepare("SELECT userId FROM bankroll_entries WHERE createdAt >= ? GROUP BY userId HAVING COUNT(*) >= 3").all(since) as { userId: string }[];
  let written = 0;
  let notified = 0;
  const base = baseUrlOrEmpty();
  for (const { userId } of users) {
    const user = findById(userId);
    if (!user) continue;
    const payload = reportFor(userId, now);
    const inserted = db.prepare("INSERT OR IGNORE INTO weekly_reports (userId, weekKey, payload, createdAt) VALUES (?,?,?,?)").run(userId, payload.weekKey, JSON.stringify(payload), nowIso()).changes > 0;
    if (!inserted) continue;
    written += 1;
    const lang = normaliseLang(user.lang);
    const text = alertText(payload, lang);
    const where = await deliver({ userId, kind: "report", dedupeKey: `report:${payload.weekKey}`, title: text.title, body: text.body, url: `${base}/app/report?lang=${lang}` });
    if (where) notified += 1;
  }
  logEvent("job.weekly", { runId: newId("job"), users: users.length, written, notified });
  return { status: "ok", users: users.length, written, notified };
}
