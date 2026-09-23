/**
 * First-party analytics, the pure half: which event names the browser may send, how a bot looks,
 * and how a landing URL becomes a traffic source. No IP ever enters an event.
 */
export const CLIENT_EVENTS = [
  "page_view", "landing_view", "sport_funnel_view", "jogo_view", "prova_view", "tool_used", "signup_view", "first_game_open",
  "ticket_viewed", "alt_expanded", "share_clicked", "plan_view", "telegram_link_started", "live_panel_open", "tipster_funnel_view",
  "referral_landing",
  // An outbound click on a bookmaker link under a ticket. Props: book, gameId, ticketId, legIndex,
  // kind (leg | ticket), deep (the URL pre-fills a betslip), verified, and what the reader was
  // offered when they clicked — coverage (full | partial | near) and covered, the number of the
  // ticket's legs that book carries at the exact line. Partial and near clicks are the measurement
  // the best-effort slip exists for: whether a reader will take most of a ticket in one tap.
  "book_click",
] as const;
export type ClientEvent = (typeof CLIENT_EVENTS)[number];

export const isClientEvent = (name: unknown): name is ClientEvent => typeof name === "string" && (CLIENT_EVENTS as readonly string[]).includes(name);

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegrambot|preview|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|axios|node-fetch|go-http/i;
/**
 * Link-preview fetchers (WhatsApp, Telegram), crawlers and headless browsers are not visitors. The
 * e2e suite drives a headless browser, so tests can allow that one case.
 */
export function isBot(ua: string | null | undefined, opts: { allowHeadless?: boolean } = {}): boolean {
  if (!ua) return true;
  if (BOT.test(ua)) return true;
  return /headless/i.test(ua) && !opts.allowHeadless;
}

export function deviceOf(ua: string | null | undefined): "mobile" | "tablet" | "desktop" {
  const s = ua ?? "";
  if (/ipad|tablet/i.test(s)) return "tablet";
  if (/mobi|android|iphone/i.test(s)) return "mobile";
  return "desktop";
}

export interface Utm { source: string; medium: string; campaign: string; content: string }

const clip = (s: string | null | undefined, n = 60) => (s ?? "").trim().toLowerCase().replace(/[^a-z0-9_.\-+ ]/g, "").slice(0, n);

export function utmFrom(search: string | URLSearchParams): Utm {
  const q = typeof search === "string" ? new URLSearchParams(search) : search;
  return { source: clip(q.get("utm_source")), medium: clip(q.get("utm_medium")), campaign: clip(q.get("utm_campaign")), content: clip(q.get("utm_content")) };
}

/** The referring host, or "" for a same-site navigation or no referrer. */
export function refHostOf(referrer: string | null | undefined, ownHost: string): string {
  if (!referrer) return "";
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();
    return host === ownHost.replace(/^www\./, "").toLowerCase() ? "" : host.slice(0, 80);
  } catch {
    return "";
  }
}

/** The channel a visit is credited to: its UTM source, else the referring site, else "direto". */
export function sourceOf(e: { utmSource?: string | null; refHost?: string | null }): string {
  if (e.utmSource) return e.utmSource;
  if (e.refHost) {
    if (/google\./.test(e.refHost)) return "google";
    if (/(^|\.)(wa\.me|whatsapp\.com)$/.test(e.refHost)) return "whatsapp";
    if (/instagram\.com$/.test(e.refHost)) return "instagram";
    if (/(^|\.)t\.me$|telegram/.test(e.refHost)) return "telegram";
    return e.refHost;
  }
  return "direto";
}

/** The named event a page view also counts as, for the funnel. */
export function pageEvent(pathname: string): ClientEvent | null {
  if (pathname === "/") return "landing_view";
  if (/^\/(basquete|futebol|basketball|soccer)$/.test(pathname)) return "sport_funnel_view";
  if (pathname.startsWith("/jogo/")) return "jogo_view";
  if (pathname === "/prova") return "prova_view";
  if (pathname === "/signup") return "signup_view";
  if (pathname === "/planos") return "plan_view";
  if (/^\/app\/game\/[^/]+$/.test(pathname)) return "first_game_open";
  if (/^\/(raio-x-tipster|tipster-audit)$/.test(pathname)) return "tipster_funnel_view";
  return null;
}

export const FIRST_TOUCH_COOKIE = "bm_ft";
export const ANON_COOKIE = "bm_aid";
export const EVENT_RETENTION_DAYS = 180;
