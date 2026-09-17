import { getDb, newId, nowIso } from "@/lib/server/db";

export const CONTACT_TOPICS = ["account", "payment", "refund", "privacy", "bug", "other"] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];
export const CONTACT_STATUSES = ["open", "answered", "closed"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export interface ContactRow {
  id: string; userId: string | null; name: string; email: string; topic: string; message: string;
  lang: string; status: ContactStatus; adminNote: string; createdAt: string; updatedAt: string;
}

const YEAR_MS = 365 * 86_400_000;

/** Retention promised in the privacy policy: resolved messages and visitor tour rows go after 12 months. */
function pruneOld(now = Date.now()): void {
  const cutoff = new Date(now - YEAR_MS).toISOString();
  const db = getDb();
  db.prepare("DELETE FROM contact_messages WHERE status != 'open' AND updatedAt < ?").run(cutoff);
  db.prepare("DELETE FROM onboarding WHERE id LIKE 'anon_%' AND firstSeenAt < ?").run(cutoff);
}

export function createContactMessage(input: { userId: string | null; name: string; email: string; topic: ContactTopic; message: string; lang: string }): string {
  const id = newId("msg");
  const now = nowIso();
  getDb().prepare(
    "INSERT INTO contact_messages (id,userId,name,email,topic,message,lang,status,adminNote,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,'open','',?,?)",
  ).run(id, input.userId, input.name, input.email.toLowerCase(), input.topic, input.message, input.lang, now, now);
  try { pruneOld(); } catch { /* retention is housekeeping; never fail the message */ }
  return id;
}

export function listContactMessages(opts: { status?: string; limit?: number } = {}): (ContactRow & { accountEmail: string | null })[] {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const where = opts.status && (CONTACT_STATUSES as readonly string[]).includes(opts.status) ? "WHERE m.status = ?" : "";
  const args: unknown[] = where ? [opts.status, limit] : [limit];
  return getDb().prepare(
    `SELECT m.*, u.email AS accountEmail FROM contact_messages m LEFT JOIN users u ON u.id = m.userId ${where}
     ORDER BY CASE m.status WHEN 'open' THEN 0 ELSE 1 END, m.createdAt DESC LIMIT ?`,
  ).all(...args) as (ContactRow & { accountEmail: string | null })[];
}

export function updateContactMessage(id: string, patch: { status?: ContactStatus; adminNote?: string }): boolean {
  const row = getDb().prepare("SELECT status, adminNote FROM contact_messages WHERE id = ?").get(id) as { status: string; adminNote: string } | undefined;
  if (!row) return false;
  getDb().prepare("UPDATE contact_messages SET status = ?, adminNote = ?, updatedAt = ? WHERE id = ?")
    .run(patch.status ?? row.status, (patch.adminNote ?? row.adminNote).slice(0, 2000), nowIso(), id);
  return true;
}

export function contactCounts(): Record<string, number> {
  const rows = getDb().prepare("SELECT status, COUNT(*) n FROM contact_messages GROUP BY status").all() as { status: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
