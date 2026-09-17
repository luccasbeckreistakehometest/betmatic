import { getDb } from "@/lib/server/db";
import { EVENT_RETENTION_DAYS, sourceOf } from "@/lib/analytics/events";

/**
 * The owner's acquisition panel: visitors, the funnel by channel, which game pages bring people in,
 * whether they come back, and which features get used. Reads the first-party events table only.
 */
export interface FunnelRow { source: string; visitors: number; signups: number; firstGame: number; saved: number; paid: number }
export interface AcquisitionReport {
  days: number;
  visitorsPerDay: { day: string; visitors: number }[];
  totals: { visitors: number; signups: number; paid: number };
  funnel: FunnelRow[];
  topGames: { path: string; views: number; signups: number }[];
  retention: { d1: { eligible: number; returned: number }; d7: { eligible: number; returned: number } };
  features: { name: string; count: number }[];
}

const FEATURE_EVENTS = ["game_generated", "ticket_saved", "custom_parlay_done", "deep_slip_done", "scan_done", "tipster_audit_done", "player_opened", "refresh_done", "live_panel_open", "alt_expanded", "tool_used", "share_clicked", "telegram_link_started"];
const DAY = 86_400_000;

interface Row { ts: string; name: string; anonId: string | null; userId: string | null; path: string; refHost: string; utmSource: string; props: string }

export function acquisitionReport(days: number, now = new Date()): AcquisitionReport {
  const db = getDb();
  const since = new Date(now.getTime() - days * DAY).toISOString();
  const rows = db.prepare("SELECT ts, name, anonId, userId, path, refHost, utmSource, props FROM events WHERE ts >= ? ORDER BY ts").all(since) as Row[];

  const visitorsPerDay = db.prepare("SELECT substr(ts,1,10) day, COUNT(DISTINCT anonId) visitors FROM events WHERE name='page_view' AND ts >= ? GROUP BY day ORDER BY day").all(since) as { day: string; visitors: number }[];

  // A visitor's channel is the first campaign or referring site seen for them in the window.
  const visitorSource = new Map<string, string>();
  for (const r of rows) {
    if (!r.anonId) continue;
    const src = r.utmSource || r.refHost ? sourceOf(r) : null;
    if (!visitorSource.has(r.anonId)) visitorSource.set(r.anonId, src ?? "direto");
    else if (src && visitorSource.get(r.anonId) === "direto") visitorSource.set(r.anonId, src);
  }
  const signups = rows.filter((r) => r.name === "signup_done" && r.userId);
  const userSource = new Map<string, string>();
  for (const s of signups) {
    let src = "direto";
    try { src = (JSON.parse(s.props) as { source?: string }).source || "direto"; } catch { /* keep direto */ }
    if (s.anonId && visitorSource.get(s.anonId) && visitorSource.get(s.anonId) !== "direto") src = src === "direto" ? visitorSource.get(s.anonId)! : src;
    userSource.set(s.userId!, src);
  }
  const did = (name: string) => new Set(rows.filter((r) => r.name === name && r.userId).map((r) => r.userId!));
  const firstGame = did("first_game_open");
  const saved = did("ticket_saved");
  const paid = did("paid");

  const bySource = new Map<string, FunnelRow>();
  const row = (source: string) => {
    if (!bySource.has(source)) bySource.set(source, { source, visitors: 0, signups: 0, firstGame: 0, saved: 0, paid: 0 });
    return bySource.get(source)!;
  };
  for (const src of visitorSource.values()) row(src).visitors += 1;
  for (const [userId, src] of userSource) {
    const r = row(src);
    r.signups += 1;
    if (firstGame.has(userId)) r.firstGame += 1;
    if (saved.has(userId)) r.saved += 1;
    if (paid.has(userId)) r.paid += 1;
  }

  const views = db.prepare("SELECT path, COUNT(*) views FROM events WHERE name='jogo_view' AND ts >= ? GROUP BY path ORDER BY views DESC LIMIT 10").all(since) as { path: string; views: number }[];
  const landing = new Map<string, number>();
  for (const s of signups) {
    try {
      const l = (JSON.parse(s.props) as { landing?: string }).landing ?? "";
      if (l.startsWith("/jogo/")) landing.set(l, (landing.get(l) ?? 0) + 1);
    } catch { /* ignore */ }
  }

  // Retention: did the account show up again a day later, and a week later?
  const seen = db.prepare("SELECT 1 FROM events WHERE userId = ? AND ts >= ? AND ts < ? LIMIT 1");
  const retention = { d1: { eligible: 0, returned: 0 }, d7: { eligible: 0, returned: 0 } };
  for (const s of signups) {
    const t = Date.parse(s.ts);
    if (now.getTime() >= t + 2 * DAY) {
      retention.d1.eligible += 1;
      if (seen.get(s.userId, new Date(t + DAY).toISOString(), new Date(t + 2 * DAY).toISOString())) retention.d1.returned += 1;
    }
    if (now.getTime() >= t + 8 * DAY) {
      retention.d7.eligible += 1;
      if (seen.get(s.userId, new Date(t + 7 * DAY).toISOString(), new Date(t + 8 * DAY).toISOString())) retention.d7.returned += 1;
    }
  }

  const features = FEATURE_EVENTS.map((name) => ({ name, count: rows.filter((r) => r.name === name).length })).filter((f) => f.count > 0).sort((a, b) => b.count - a.count);
  return {
    days,
    visitorsPerDay,
    totals: { visitors: visitorSource.size, signups: signups.length, paid: [...userSource.keys()].filter((u) => paid.has(u)).length },
    funnel: [...bySource.values()].sort((a, b) => b.visitors - a.visitors || b.signups - a.signups),
    topGames: views.map((v) => ({ ...v, signups: landing.get(v.path) ?? 0 })),
    retention,
    features,
  };
}

/** Daily: events older than the retention window are deleted. */
export function cleanupEvents(now = new Date()): number {
  return getDb().prepare("DELETE FROM events WHERE ts < ?").run(new Date(now.getTime() - EVENT_RETENTION_DAYS * DAY).toISOString()).changes;
}
