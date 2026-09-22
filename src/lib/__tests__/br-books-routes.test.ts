import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-books-routes");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });

const user = { current: null as null | { id: string; role: "user" | "admin"; plan: { id: string; gamesPerDay: null; bands: string[]; crossGame: boolean; delayMinutes: number; sports: string[] }; planActive: boolean; lang: "pt" } };
vi.mock("@/lib/server/session", () => ({ currentUser: async () => user.current, requireAdmin: async () => (user.current?.role === "admin" ? user.current : null) }));
vi.mock("@/lib/sources/espn", async (orig) => ({ ...(await orig<typeof import("@/lib/sources/espn")>()), getGameDetail: async () => null }));

const { GET: prices } = await import("@/app/api/game/[gameId]/prices/route");
const { GET: adminGet, POST: adminPost } = await import("@/app/api/admin/books/route");
const params = (gameId: string) => ({ params: Promise.resolve({ gameId }) });

describe("/api/game/[id]/prices", () => {
  it("answers an anonymous visitor, a bad sport and a bad date with the empty payload, never an error", async () => {
    user.current = null;
    for (const url of ["http://x/api/game/401857208/prices?sport=wnba&date=20260922&lang=pt", "http://x/api/game/401857208/prices?sport=tennis-atp&date=20260922", "http://x/api/game/abc/prices?sport=wnba&date=2026"]) {
      const res = await prices(new Request(url), params(url.split("/")[5]));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ books: [], fetchedAt: null, tickets: [], signals: [] });
    }
  });

  it("shows a signed-in viewer nothing when the entitlement pass shows no tickets", async () => {
    user.current = { id: "u1", role: "user", plan: { id: "free", gamesPerDay: null, bands: ["safe"], crossGame: false, delayMinutes: 0, sports: [] }, planActive: true, lang: "pt" };
    const res = await prices(new Request("http://x/api/game/401857208/prices?sport=wnba&date=20260922&lang=pt"), params("401857208"));
    expect(await res.json()).toEqual({ books: [], fetchedAt: null, tickets: [], signals: [] });
  });
});

describe("/api/admin/books", () => {
  it("refuses everyone but an admin", async () => {
    user.current = null;
    expect((await adminGet()).status).toBe(403);
    expect((await adminPost(new Request("http://x/api/admin/books", { method: "POST", body: JSON.stringify({ action: "run" }) }))).status).toBe(403);
    user.current = { id: "u1", role: "user", plan: { id: "max", gamesPerDay: null, bands: [], crossGame: true, delayMinutes: 0, sports: [] }, planActive: true, lang: "pt" };
    expect((await adminGet()).status).toBe(403);
  });

  it("lists every adapter as inactive on a deploy that never set BR_BOOKS", async () => {
    user.current = { id: "a1", role: "admin", plan: { id: "max", gamesPerDay: null, bands: [], crossGame: true, delayMinutes: 0, sports: [] }, planActive: true, lang: "pt" };
    delete process.env.BR_BOOKS;
    const body = await (await adminGet()).json();
    expect(body.adapters.length).toBe(10);
    expect(body.adapters.every((a: { active: boolean }) => a.active === false)).toBe(true);
    expect(body.skipped.length).toBeGreaterThan(5);
    const res = await adminPost(new Request("http://x/api/admin/books", { method: "POST", body: JSON.stringify({ action: "toggle", id: "nope", enabled: true }) }));
    expect(res.status).toBe(400);
  });
});
