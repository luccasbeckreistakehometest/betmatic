import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-analytics");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => { jar.set(k, v); } }),
}));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => null }));

const { isBot, pageEvent, refHostOf, sourceOf, utmFrom } = await import("@/lib/analytics/events");
const { POST } = await import("@/app/api/e/route");
const { acquisitionReport, cleanupEvents } = await import("@/lib/server/analytics-report");
const { recordEvent } = await import("@/lib/server/analytics");
const { getDb } = await import("@/lib/server/db");

const CHROME = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const beacon = (body: object, ua = CHROME) => new Request("http://x/api/e", { method: "POST", headers: { "user-agent": ua }, body: JSON.stringify(body) });

describe("event hygiene", () => {
  it("drops bots, link previews and headless browsers", () => {
    expect(isBot("WhatsApp/2.23.20.0")).toBe(true);
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBot("Mozilla/5.0 HeadlessChrome/140.0 Safari/537.36")).toBe(true);
    expect(isBot("Mozilla/5.0 HeadlessChrome/140.0 Safari/537.36", { allowHeadless: true })).toBe(false);
    expect(isBot(CHROME)).toBe(false);
    expect(isBot(null)).toBe(true);
  });

  it("reads UTM, the referring host and the channel", () => {
    expect(utmFrom("?utm_source=WhatsApp&utm_campaign=Rodada 25<script>")).toMatchObject({ source: "whatsapp", campaign: "rodada 25script" });
    expect(refHostOf("https://www.google.com/search?q=x", "betmatic.marqa.online")).toBe("google.com");
    expect(refHostOf("https://betmatic.marqa.online/prova", "betmatic.marqa.online")).toBe("");
    expect(sourceOf({ refHost: "l.instagram.com" })).toBe("instagram");
    expect(sourceOf({})).toBe("direto");
    expect(pageEvent("/jogo/123")).toBe("jogo_view");
    expect(pageEvent("/app/game/9")).toBe("first_game_open");
    expect(pageEvent("/app/bankroll")).toBeNull();
  });
});

describe("beacon route", () => {
  it("rejects unknown names, ignores bots, stores no IP and sets the first-touch cookie", async () => {
    expect((await POST(beacon({ name: "drop_table" }))).status).toBe(400);
    expect((await POST(beacon({ name: "page_view", path: "/" }, "Googlebot/2.1"))).status).toBe(204);
    expect(getDb().prepare("SELECT COUNT(*) n FROM events").get()).toEqual({ n: 0 });
    const ok = await POST(beacon({ name: "landing_view", path: "/", search: "?utm_source=whatsapp&utm_campaign=teste", referrer: "" }));
    expect(ok.status).toBe(204);
    expect(jar.get("bm_aid")).toMatch(/^[a-f0-9]{24}$/);
    expect(JSON.parse(jar.get("bm_ft")!)).toMatchObject({ s: "whatsapp", c: "teste", l: "/" });
    const cols = (getDb().prepare("PRAGMA table_info(events)").all() as { name: string }[]).map((c) => c.name);
    expect(cols.some((c) => /ip/i.test(c))).toBe(false);
    expect(getDb().prepare("SELECT name, utmSource, anonId FROM events").get()).toMatchObject({ name: "landing_view", utmSource: "whatsapp", anonId: jar.get("bm_aid") });
  });
});

describe("acquisition report", () => {
  it("builds the funnel per channel and cleans up old rows", () => {
    const db = getDb();
    db.prepare("DELETE FROM events").run();
    const now = new Date("2026-09-17T12:00:00Z");
    const ins = (ts: string, name: string, anonId: string | null, userId: string | null, extra: Record<string, string> = {}) =>
      db.prepare("INSERT INTO events (ts, name, anonId, userId, path, refHost, utmSource, props) VALUES (?,?,?,?,?,?,?,?)").run(ts, name, anonId, userId, extra.path ?? "/", extra.refHost ?? "", extra.utmSource ?? "", extra.props ?? "{}");
    ins("2026-09-15T10:00:00Z", "page_view", "a1", null, { utmSource: "whatsapp" });
    ins("2026-09-15T10:01:00Z", "signup_done", "a1", "u1", { props: JSON.stringify({ source: "whatsapp", landing: "/jogo/1" }) });
    ins("2026-09-15T10:02:00Z", "first_game_open", "a1", "u1");
    ins("2026-09-15T10:03:00Z", "ticket_saved", "a1", "u1");
    ins("2026-09-16T11:00:00Z", "page_view", "a1", "u1");
    ins("2026-09-15T12:00:00Z", "page_view", "a2", null, { refHost: "google.com" });
    ins("2026-09-15T12:00:00Z", "jogo_view", "a2", null, { path: "/jogo/1" });
    ins("2026-09-16T09:00:00Z", "page_view", "a3", null);
    ins("2026-01-01T00:00:00Z", "page_view", "old", null);
    recordEvent("paid", "u1", { kind: "plan" });
    db.prepare("UPDATE events SET ts='2026-09-16T12:00:00Z' WHERE name='paid'").run();
    const r = acquisitionReport(7, now);
    expect(r.totals).toEqual({ visitors: 3, signups: 1, paid: 1 });
    expect(r.funnel.find((f) => f.source === "whatsapp")).toEqual({ source: "whatsapp", visitors: 1, signups: 1, firstGame: 1, saved: 1, paid: 1 });
    expect(r.funnel.find((f) => f.source === "google")).toMatchObject({ visitors: 1, signups: 0 });
    expect(r.topGames).toEqual([{ path: "/jogo/1", views: 1, signups: 1 }]);
    expect(r.retention.d1).toEqual({ eligible: 1, returned: 1 });
    expect(r.features.find((f) => f.name === "ticket_saved")?.count).toBe(1);
    expect(cleanupEvents(now)).toBe(1);
  });
});
