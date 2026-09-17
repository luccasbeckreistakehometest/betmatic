import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-deep-route");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
process.env.AI_MOCK = "1";
fs.rmSync(DIR, { recursive: true, force: true });

let sessionUser: unknown = null;
vi.mock("@/lib/server/session", () => ({ currentUser: async () => sessionUser }));
const verdict = vi.fn();
vi.mock("@/lib/bets/analyse", () => ({ analyseSlip: (...a: unknown[]) => verdict(...a) }));
vi.mock("@/lib/server/deep-slip", () => ({
  buildDeepContext: async () => ({ legs: [{ index: 0, kind: "unknown", selection: "x" }], flags: ["Pernas 1 e 2: …"], resolved: 0, parsed: 0 }),
  deepPrompt: () => "VERIFIED",
}));

const { POST } = await import("@/app/api/slip/route");
const { createUser, toPublic, findById, adjustCoins, setPlanByAdmin } = await import("@/lib/server/users");

const body = (deep: boolean) => new Request("http://x/api/slip", { method: "POST", body: JSON.stringify({ lang: "pt", deep, sport: "wnba", legs: [{ selection: "A", market: "", odds: "1.9" }, { selection: "B", market: "", odds: "2.0" }] }) });

describe("deep slip route", async () => {
  const row = await createUser({ email: `deep${Date.now()}@example.com`, name: "d", password: "password123" });
  adjustCoins(row.id, 40, "test");

  it("charges 14 on Pro and 8 on Max, and passes the verified block to the verdict", async () => {
    verdict.mockResolvedValue({ verdict: "ok", legs: [], weakestIndex: -1, swaps: [], correlationNote: "", combinedDecimal: 3.8, combinedAmerican: "+280", impliedProbability: 0.26, modelledProbability: 0.2, edgePct: -1 });
    setPlanByAdmin(row.id, "pro", new Date(Date.now() + 86_400_000).toISOString());
    sessionUser = toPublic(findById(row.id)!);
    const pro = await (await POST(body(true))).json();
    expect(pro.coinsSpent).toBe(14);
    expect(verdict.mock.calls[0][2]).toEqual({ context: "VERIFIED" });
    setPlanByAdmin(row.id, "max", new Date(Date.now() + 86_400_000).toISOString());
    sessionUser = toPublic(findById(row.id)!);
    expect((await (await POST(body(true))).json()).coinsSpent).toBe(8);
    expect(findById(row.id)!.coins).toBe(40 - 14 - 8);
  });

  it("keeps the checked legs and refunds when the verdict fails", async () => {
    verdict.mockRejectedValue(new Error("model down"));
    sessionUser = toPublic(findById(row.id)!);
    const before = findById(row.id)!.coins;
    const res = await POST(body(true));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.analysis).toBeNull();
    expect(j.deep.flags).toHaveLength(1);
    expect(j.refunded).toBe(8);
    expect(findById(row.id)!.coins).toBe(before);
  });
});
