import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-custom-route");
process.env.DATA_DIR = DIR;
process.env.CACHE_DIR = path.join(DIR, "cache");
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
process.env.AI_MOCK = "1";
fs.rmSync(DIR, { recursive: true, force: true });

let sessionUser: unknown = null;
vi.mock("@/lib/server/session", () => ({ currentUser: async () => sessionUser }));
const poolFn = vi.fn();
vi.mock("@/lib/server/leg-pool", () => ({ buildLegPool: (...a: unknown[]) => poolFn(...a) }));

const { POST } = await import("@/app/api/parlays/custom/route");
const { createUser, toPublic, adjustCoins, findById, setPlanByAdmin } = await import("@/lib/server/users");

const leg = (key: string, gameId: string, decimal: number, fair: number) => ({
  key, gameId, matchup: gameId, selection: key, market: "points", decimal, fairProbability: fair, measured: true, measuredRate: fair, evidence: "L5 3/5",
  settlement: { type: "player_prop", player: key, stat: "points", line: 10.5, side: "over", sourceBasis: "measured history" },
});
const pool = Array.from({ length: 6 }, (_, i) => leg(`p${i}`, `g${i}`, 2.2 + i * 0.1, 0.6));
const body = (target: number) => new Request("http://x/api/parlays/custom", { method: "POST", body: JSON.stringify({ sport: "wnba", target, maxLegs: 4, measuredOnly: true, minRate: 0.5 }) });

describe("custom parlay route", async () => {
  const row = await createUser({ email: `c${Date.now()}@example.com`, name: "c", password: "password123" });
  beforeEach(() => {
    poolFn.mockReset();
    poolFn.mockResolvedValue({ pool, games: [], dateKey: "20260917" });
  });

  it("debits 12 coins for a reachable target and saves the result", async () => {
    adjustCoins(row.id, 30, "test");
    sessionUser = toPublic(findById(row.id)!);
    const res = await POST(body(10));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.reachable).toBe(true);
    expect(j.tickets.length).toBeGreaterThan(0);
    expect(j.coinsSpent).toBe(12);
    expect(findById(row.id)!.coins).toBe(18);
  });

  it("refunds everything when the target cannot be reached", async () => {
    sessionUser = toPublic(findById(row.id)!);
    const res = await POST(body(480));
    const j = await res.json();
    expect(j.reachable).toBe(false);
    expect(j.nearest).toBeGreaterThan(20);
    expect(findById(row.id)!.coins).toBe(18);
  });

  it("refunds everything when building the pool fails", async () => {
    poolFn.mockRejectedValueOnce(new Error("ESPN down"));
    sessionUser = toPublic(findById(row.id)!);
    const res = await POST(body(7));
    expect(res.status).toBe(502);
    expect(findById(row.id)!.coins).toBe(18);
  });

  it("refuses without enough coins", async () => {
    adjustCoins(row.id, -18, "test");
    sessionUser = toPublic(findById(row.id)!);
    expect((await POST(body(10))).status).toBe(402);
  });

  it("adds ticket legs only from the sports and bands the plan shows", async () => {
    const starter = await createUser({ email: `cs${Date.now()}@example.com`, name: "s", password: "password123" });
    setPlanByAdmin(starter.id, "starter", new Date(Date.now() + 30 * 86_400_000).toISOString());
    adjustCoins(starter.id, 100, "test");
    const req = (sport: string, target: number) => new Request("http://x/api/parlays/custom", { method: "POST", body: JSON.stringify({ sport, target, maxLegs: 4, measuredOnly: true, minRate: 0.5 }) });
    sessionUser = toPublic(findById(starter.id)!);
    await POST(req("wnba", 9));
    expect(poolFn.mock.calls.at(-1)?.[1]).toMatchObject({ ticketBands: ["mid", "safe", "value"] });
    // Starter covers basketball only: football tickets stay out of its pool
    await POST(req("soccer-bra", 9));
    expect(poolFn.mock.calls.at(-1)?.[1]).toMatchObject({ ticketBands: [] });
    // the free plan never pools ticket legs, and a cached Starter result is not reused for it
    const free = await createUser({ email: `cf${Date.now()}@example.com`, name: "f", password: "password123" });
    adjustCoins(free.id, 100, "test");
    sessionUser = toPublic(findById(free.id)!);
    const calls = poolFn.mock.calls.length;
    await POST(req("wnba", 9));
    expect(poolFn.mock.calls.length).toBe(calls + 1);
    expect(poolFn.mock.calls.at(-1)?.[1]).toMatchObject({ ticketBands: [] });
  });
});
