import { getDb, nowIso } from "@/lib/server/db";

/**
 * Server-side funnel events (authoritative: they happen after the action succeeded). Never throws —
 * analytics must not break the feature it measures. No IP, no free text beyond small props.
 */
export const SERVER_EVENTS = ["signup_done", "game_generated", "ticket_saved", "coins_spent", "scan_done", "custom_parlay_done", "checkout_started", "paid", "tipster_audit_done", "player_opened", "deep_slip_done", "refresh_done"] as const;
export type ServerEvent = (typeof SERVER_EVENTS)[number];

export function recordEvent(name: ServerEvent, userId: string | null, props: Record<string, unknown> = {}, extra: { anonId?: string | null; path?: string } = {}): void {
  try {
    const json = JSON.stringify(props);
    getDb().prepare("INSERT INTO events (ts, name, anonId, userId, path, props) VALUES (?,?,?,?,?,?)")
      .run(nowIso(), name, extra.anonId ?? null, userId, (extra.path ?? "").slice(0, 200), json.length <= 1024 ? json : "{}");
  } catch {
    // Best-effort by design.
  }
}
