import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-tipster");
process.env.DATA_DIR = DIR;
process.env.CACHE_DIR = path.join(DIR, "cache");
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
process.env.AI_MOCK = "1";
fs.rmSync(DIR, { recursive: true, force: true });

const HOUR = 3_600_000;
const kickoff = new Date(Date.now() - 26 * HOUR).toISOString();
const team = (id: string, abbreviation: string, displayName: string, score?: number) => ({ id, abbreviation, displayName, name: displayName, score });
const game = { id: "202", sportKey: "soccer-bra", startsAt: kickoff, status: "final", statusDetail: "FT", home: team("1", "TUP", "Tupi FC", 2), away: team("2", "IPE", "Ipê EC", 1) };
vi.mock("@/lib/sources/espn", async (orig) => ({
  ...(await orig<typeof import("@/lib/sources/espn")>()),
  getSlate: async () => [game],
  getGameDetail: async () => ({ game, books: [{ provider: "X", homeMoneyline: 110, awayMoneyline: 250, overUnder: 2.5, overOdds: -120, underOdds: 100 }], injuries: [], leaders: [], rosters: [], ats: [], lastMeetings: [], teamStats: { home: [], away: [] } }),
}));
let sessionUser: unknown = null;
vi.mock("@/lib/server/session", () => ({ currentUser: async () => sessionUser }));
let emptyPicks = false;
vi.mock("@/lib/server/tipster", async (orig) => {
  const real = await orig<typeof import("@/lib/server/tipster")>();
  return { ...real, extractPicks: async (input: Parameters<typeof real.extractPicks>[0]) => (emptyPicks ? [] : real.extractPicks(input)) };
});

const { auditReport, longestLosingRun, postedLate, redFlags, shareText } = await import("@/lib/tipster/audit");
const { POST, GET, DELETE } = await import("@/app/api/tipster/route");
const { adjustCoins, createUser, toPublic, findById } = await import("@/lib/server/users");
const { getDb } = await import("@/lib/server/db");

const pick = (outcome: string, extra: object = {}) => ({ postedAt: null, startsAt: null, event: "", selection: "", matchup: null, odds: 2, oddsSource: "stated" as const, claimed: null, outcome, ...extra }) as never;

describe("audit maths", () => {
  it("counts real hits, ROI at 1u, unverifiable share and the longest losing run", () => {
    const picks = [pick("won", { startsAt: "1" }), pick("lost", { startsAt: "2" }), pick("lost", { startsAt: "3" }), pick("won", { startsAt: "4", odds: 3 }), pick("unverifiable"), pick("void")];
    const r = auditReport(picks, []);
    expect(r).toMatchObject({ total: 6, verifiable: 5, won: 2, lost: 2, hitRate: 0.5, roiPicks: 4 });
    expect(r.roi).toBeCloseTo((1 - 1 - 1 + 2) / 4, 6);
    expect(longestLosingRun(picks)).toBe(2);
  });

  it("flags a pick posted after kickoff, and the classic VIP phrases", () => {
    expect(postedLate({ postedAt: "2026-09-16T21:00:00Z", startsAt: "2026-09-16T20:00:00Z" })).toBe(true);
    expect(postedLate({ postedAt: "2026-09-16T19:00:00Z", startsAt: "2026-09-16T20:00:00Z" })).toBe(false);
    expect(postedLate({ postedAt: null, startsAt: "2026-09-16T20:00:00Z" })).toBe(false);
    // a pick called live is not a fake, and a few minutes of clock drift are tolerated
    expect(postedLate({ postedAt: "2026-09-16T21:00:00Z", startsAt: "2026-09-16T20:00:00Z", live: true })).toBe(false);
    expect(postedLate({ postedAt: "2026-09-16T20:04:00Z", startsAt: "2026-09-16T20:00:00Z", live: false })).toBe(false);
    // 17:30 in Brasília is 20:30 UTC: with the offset the model is told to write, it is after a 20:00 UTC kickoff
    expect(postedLate({ postedAt: "2026-09-16T17:30:00-03:00", startsAt: "2026-09-16T20:00:00Z" })).toBe(true);
    expect(postedLate({ postedAt: "2026-09-16T16:30:00-03:00", startsAt: "2026-09-16T20:00:00Z" })).toBe(false);
    expect(redFlags("GREEN GARANTIDO! Últimas vagas no grupo VIP, recupere o prejuízo hoje")).toEqual(["guaranteed", "urgency", "chasing", "vip_upsell"]);
    expect(redFlags("Palpite: Flamengo vence, odd 1.80")).toEqual([]);
  });

  it("shares numbers only", () => {
    const r = auditReport([pick("won"), pick("lost")], []);
    expect(shareText(r, "pt")).toBe("Conferi 2 palpites de um tipster no Betmatic: 100% verificáveis, acerto real 50%.");
  });
});

describe("tipster route", async () => {
  const row = await createUser({ email: `tip${Date.now()}@example.com`, name: "t", password: "password123" });
  const body = (extra = false) => new Request("http://x/api/tipster", { method: "POST", body: JSON.stringify({ sport: "soccer-bra", label: "Grupo Teste", text: "RAWTOKEN-7731 green garantido, últimas vagas", extra }) });

  it("grades the picks, keeps no raw text, caps the free month and lets the user delete", async () => {
    sessionUser = toPublic(findById(row.id)!);
    const res = await POST(body());
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.report).toMatchObject({ total: 4, verifiable: 3, won: 2, lost: 1, postedAfterKickoff: 1, claimedGreens: 4, realGreensAmongClaimed: 2, estimatedOdds: 1 });
    expect(j.report.flags).toEqual(["guaranteed", "urgency"]);
    const stored = JSON.stringify(getDb().prepare("SELECT * FROM tipster_audits").all());
    expect(stored).toContain("Grupo Teste");
    expect(stored).not.toContain("RAWTOKEN-7731");
    const capped = await POST(body());
    expect(capped.status).toBe(402);
    expect((await capped.json()).error).toBe("tipster_cap");
    const broke = await POST(body(true));
    expect((await broke.json()).error).toBe("insufficient_coins");
    const list = await (await GET(new Request("http://x/api/tipster"))).json();
    expect(list.audits).toHaveLength(1);
    expect((await DELETE(new Request(`http://x/api/tipster?id=${list.audits[0].id}`))).status).toBe(200);
    expect(getDb().prepare("SELECT COUNT(*) n FROM tipster_audits").get()).toEqual({ n: 0 });
  });

  it("an empty read keeps the period's slot, refunds coins, and every model call counts toward a daily and a global try cap", async () => {
    const u = await createUser({ email: `tipempty${Date.now()}@example.com`, name: "e", password: "password123" });
    adjustCoins(u.id, 20, "test", {});
    sessionUser = toPublic(findById(u.id)!);
    emptyPicks = true;
    try {
      const first = await POST(body());
      expect(first.status).toBe(422);
      expect((await first.json()).error).toBe("tipster_unreadable");
      expect((await (await GET(new Request("http://x/api/tipster"))).json()).allowance.used).toBe(1);
      // the slot stayed used: the next free audit is capped
      expect((await (await POST(body())).json()).error).toBe("tipster_cap");
      // extras past the allowance: an empty read gives the coins back, up to the daily try cap (3 on the free plan)
      for (let i = 0; i < 2; i++) expect((await POST(body(true))).status).toBe(422);
      expect(findById(u.id)!.coins).toBe(20);
      const tired = await POST(body(true));
      expect(tired.status).toBe(429);
      expect((await tired.json()).error).toBe("ai_tries");
      expect(findById(u.id)!.coins).toBe(20);
      // the global ceiling counts every account's calls
      process.env.TIPSTER_DAILY_CAP = "3";
      const other = await createUser({ email: `tipglobal${Date.now()}@example.com`, name: "g", password: "password123" });
      sessionUser = toPublic(findById(other.id)!);
      const busy = await POST(body());
      expect(busy.status).toBe(503);
      expect((await busy.json()).error).toBe("tipster_busy");
    } finally {
      emptyPicks = false;
      delete process.env.TIPSTER_DAILY_CAP;
    }
  });
});
