import { getDb, newId, nowIso } from "@/lib/server/db";

/**
 * Global daily AI spend ceiling — the kill switch. Every model call records its cost (ai_usage);
 * before a call, the day's recorded total is compared with AI_DAILY_BUDGET_USD. The day is the
 * Brasília calendar day (UTC-3, no DST since 2019).
 */
export const DEFAULT_DAILY_BUDGET_USD = 20;

export function aiDailyBudgetUsd(env: Record<string, string | undefined> = process.env): number {
  const raw = env.AI_DAILY_BUDGET_USD;
  if (raw === undefined || raw.trim() === "") return DEFAULT_DAILY_BUDGET_USD;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DAILY_BUDGET_USD;
}

/** Start of the current Brasília day, as an ISO instant. */
export function brasiliaDayStart(now = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${day}T00:00:00-03:00`).toISOString();
}

export function aiSpendToday(now = new Date()): number {
  const row = getDb().prepare("SELECT COALESCE(SUM(costUsd),0) AS c FROM ai_usage WHERE createdAt >= ?").get(brasiliaDayStart(now)) as { c: number };
  return row.c;
}

export function recordAiSpend(input: { label: string; model: string; inputTokens: number; outputTokens: number; costUsd: number }): void {
  getDb().prepare("INSERT INTO ai_usage (id,label,model,inputTokens,outputTokens,costUsd,createdAt) VALUES (?,?,?,?,?,?,?)")
    .run(newId("ai"), input.label.slice(0, 120), input.model, input.inputTokens, input.outputTokens, input.costUsd, nowIso());
}

export class AiBudgetExceededError extends Error {
  constructor(public spent: number, public budget: number) {
    super(`AI daily budget reached: $${spent.toFixed(2)} of $${budget.toFixed(2)} (AI_DAILY_BUDGET_USD).`);
    this.name = "AiBudgetExceededError";
  }
}

export function budgetState(now = new Date()): { spent: number; budget: number; exhausted: boolean } {
  const budget = aiDailyBudgetUsd();
  const spent = aiSpendToday(now);
  return { spent, budget, exhausted: spent >= budget };
}

/** Throws when today's recorded spend has reached the ceiling. 0 = AI switched off. */
export function assertAiBudget(): void {
  const { spent, budget, exhausted } = budgetState();
  if (exhausted) throw new AiBudgetExceededError(spent, budget);
}

export function spendByDay(days = 7): { day: string; costUsd: number; calls: number }[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return getDb().prepare(
    `SELECT substr(datetime(createdAt, '-3 hours'), 1, 10) AS day, ROUND(SUM(costUsd), 4) AS costUsd, COUNT(*) AS calls
     FROM ai_usage WHERE createdAt >= ? GROUP BY day ORDER BY day DESC`,
  ).all(since) as { day: string; costUsd: number; calls: number }[];
}
