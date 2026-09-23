import { cookies } from "next/headers";
import { getDb, nowIso } from "@/lib/server/db";
import { ANON_COOKIE, FIRST_TOUCH_COOKIE } from "@/lib/analytics/events";

/**
 * Server-side funnel events (authoritative: they happen after the action succeeded). Never throws —
 * analytics must not break the feature it measures. No IP, no free text beyond small props.
 */
export const SERVER_EVENTS = ["signup_done", "game_generated", "ticket_saved", "coins_spent", "scan_done", "custom_parlay_done", "checkout_started", "paid", "tipster_audit_done", "player_opened", "deep_slip_done", "refresh_done", "today_bet_logged"] as const;
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

/** The visitor id cookie, when the request carries one (links a signup to the visits before it). */
export async function anonIdFromCookies(): Promise<string | null> {
  try {
    const v = (await cookies()).get(ANON_COOKIE)?.value ?? "";
    return /^[a-f0-9]{24}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export interface FirstTouch { s: string; m: string; c: string; t: string; r: string; l: string; at: string }

export async function firstTouchFromCookies(): Promise<FirstTouch | null> {
  try {
    const raw = (await cookies()).get(FIRST_TOUCH_COOKIE)?.value;
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<FirstTouch>;
    const str = (x: unknown, n: number) => (typeof x === "string" ? x.slice(0, n) : "");
    return { s: str(v.s, 60), m: str(v.m, 60), c: str(v.c, 60), t: str(v.t, 60), r: str(v.r, 80), l: str(v.l, 200), at: str(v.at, 30) };
  } catch {
    return null;
  }
}

/** A server event from a route, with the visitor id when the browser has one. */
export async function recordRouteEvent(name: ServerEvent, userId: string | null, props: Record<string, unknown> = {}): Promise<void> {
  recordEvent(name, userId, props, { anonId: await anonIdFromCookies() });
}
