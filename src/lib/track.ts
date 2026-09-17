import type { ClientEvent } from "@/lib/analytics/events";

/**
 * Sends one analytics event with sendBeacon (fetch keepalive as the fallback). Fire and forget:
 * never throws, never blocks, never sets state.
 */
export function track(name: ClientEvent, props: Record<string, string | number | boolean> = {}): void {
  try {
    if (typeof window === "undefined") return;
    const payload = JSON.stringify({ name, path: window.location.pathname, search: window.location.search, referrer: document.referrer, props });
    const blob = new Blob([payload], { type: "text/plain" });
    if (!navigator.sendBeacon?.("/api/e", blob)) void fetch("/api/e", { method: "POST", body: payload, keepalive: true }).catch(() => {});
  } catch {
    // Analytics never breaks a page.
  }
}
