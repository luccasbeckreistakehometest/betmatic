import { getDb, newId, nowIso } from "@/lib/server/db";
import { describeAiError } from "@/lib/ai/client";

/**
 * Operator-facing signals. One JSON line per event on stdout (what `docker compose logs` keeps) and,
 * for problems, a row the admin panel lists. Users never see these details.
 */
export function logEvent(event: string, data: Record<string, unknown> = {}): void {
  try {
    console.log(JSON.stringify({ ts: nowIso(), event, ...data }));
  } catch {
    console.log(`[event] ${event}`);
  }
}

export function reportError(scope: string, error: unknown, meta: Record<string, unknown> = {}, level: "error" | "warn" = "error"): string {
  const detail = describeAiError(error) ?? (error instanceof Error ? error.message : String(error ?? "unknown"));
  const line = JSON.stringify({ ts: nowIso(), level, scope, message: detail, ...meta });
  if (level === "error") console.error(line);
  else console.warn(line);
  try {
    getDb().prepare("INSERT INTO ops_log (id, level, scope, message, meta, createdAt) VALUES (?,?,?,?,?,?)")
      .run(newId("ops"), level, scope, detail.slice(0, 2000), JSON.stringify(meta).slice(0, 4000), nowIso());
    // Keep the table bounded; the log on disk is the long-term record.
    getDb().prepare("DELETE FROM ops_log WHERE id IN (SELECT id FROM ops_log ORDER BY createdAt DESC LIMIT -1 OFFSET 2000)").run();
  } catch {
    // Logging must never break the request that failed.
  }
  return detail;
}

export interface OpsRow { id: string; level: string; scope: string; message: string; meta: string; createdAt: string }

export function listOps(limit = 50): OpsRow[] {
  return getDb().prepare("SELECT * FROM ops_log ORDER BY createdAt DESC LIMIT ?").all(Math.min(limit, 200)) as OpsRow[];
}
