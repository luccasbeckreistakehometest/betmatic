import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-scan");
process.env.DATA_DIR = DIR;
process.env.CACHE_DIR = path.join(DIR, "cache");
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
process.env.AI_MOCK = "1";
fs.rmSync(DIR, { recursive: true, force: true });

const team = (abbreviation: string, displayName: string, id: string) => ({ id, abbreviation, displayName, name: displayName });
const games = [
  { id: "202", sportKey: "soccer-bra", startsAt: "2026-09-16T20:00:00.000Z", home: team("TUP", "Tupi FC", "1"), away: team("IPE", "Ipê EC", "2"), athletes: [{ id: "88001", name: "Rafa Moura", team: "TUP" }] },
  { id: "203", sportKey: "soccer-bra", startsAt: "2026-09-17T20:00:00.000Z", home: team("CAM", "Atlético-MG", "3"), away: team("FLA", "Flamengo", "4"), athletes: [] },
];
vi.mock("@/lib/server/deep-slip", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/deep-slip")>()),
  slateContexts: async () => ({ contexts: games, details: new Map() }),
}));
let sessionUser: unknown = null;
vi.mock("@/lib/server/session", () => ({ currentUser: async () => sessionUser }));

const { slipChecks, checkText, resolveScanLeg, gameForEvent, sniffImage, settlementFor } = await import("@/lib/bets/slip-scan");
const { POST } = await import("@/app/api/slip/scan/route");
const { createUser, toPublic, findById } = await import("@/lib/server/users");

describe("slip checks", () => {
  it("flags a misread odd on a multiple and accepts the right one", () => {
    const bad = slipChecks({ betType: "multiple", stake: 10, totalOdds: 4.1, potentialReturn: 41, legs: [{ odds: 2.1 }, { odds: 1.59 }] });
    expect(bad.map((c) => [c.kind, c.ok])).toEqual([["product", false], ["return", true]]);
    expect(checkText(bad[0], "pt")).toContain("não bate com a odd total (4,10)");
    const good = slipChecks({ betType: "multiple", stake: 10, totalOdds: 4.1, potentialReturn: 41, legs: [{ odds: 2.1 }, { odds: 1.95 }] });
    expect(good.every((c) => c.ok)).toBe(true);
  });

  it("explains the bet-builder discount instead of calling it an error", () => {
    const [c] = slipChecks({ betType: "bet_builder", stake: null, totalOdds: 2.45, potentialReturn: null, legs: [{ odds: 1.9 }, { odds: 2.205 }] });
    expect(c).toMatchObject({ kind: "builder_discount", ok: true });
    expect(checkText(c, "pt")).toBe("Criar Aposta: a casa descontou a correlação (produto 4,19, cupom 2,45).");
  });

  it("checks a single and the return", () => {
    const out = slipChecks({ betType: "single", stake: 20, totalOdds: 1.8, potentialReturn: 30, legs: [{ odds: 1.8 }] });
    expect(out.map((c) => [c.kind, c.ok])).toEqual([["single", true], ["return", false]]);
  });
});

describe("placing printed legs", () => {
  it("finds the game from the event line, including club nicknames", () => {
    expect(gameForEvent("Tupi FC x Ipê EC", games)?.id).toBe("202");
    expect(gameForEvent("Galo x Mengão", games)?.id).toBe("203");
    expect(gameForEvent("Palmeiras x Santos", games)).toBeNull();
  });

  it("reads a winner, the game total, a player leg and leaves the rest manual", () => {
    const leg = (selection: string, market = "", event = "Tupi FC x Ipê EC") => ({ event, selection, market, odds: 2, startsAt: null });
    const ml = resolveScanLeg(leg("Tupi FC", "Resultado Final"), 0, games);
    expect(ml).toMatchObject({ kind: "moneyline", team: "TUP", gameId: "202" });
    expect(settlementFor(ml, "TUP")).toMatchObject({ type: "moneyline", teamAbbreviation: "TUP", side: "home" });
    const total = resolveScanLeg(leg("Mais de 2,5", "Total de gols"), 1, games);
    expect(total).toMatchObject({ kind: "total", line: 2.5, side: "over", team: null });
    expect(settlementFor(total, "TUP")).toMatchObject({ type: "total", line: 2.5, side: "over" });
    const player = resolveScanLeg(leg("Rafa Moura 2+ finalizações", "Jogador - Finalizações"), 2, games);
    expect(player).toMatchObject({ kind: "player", athleteId: "88001", marketKey: "shots", line: 1.5 });
    const both = resolveScanLeg(leg("Ambas marcam - Sim", "Ambas Marcam"), 3, games);
    expect(settlementFor(both, "TUP")).toBeNull();
    expect(resolveScanLeg(leg("Palmeiras vence", "", "Palmeiras x Santos"), 4, games).kind).toBe("unknown");
  });

  it("sniffs the three accepted image types and nothing else", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("image/jpeg");
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffImage(new TextEncoder().encode("RIFF....WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("<svg xmlns=...>"))).toBeNull();
  });
});

const listFiles = (dir: string): string[] => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)])) : [];

describe("scan route", async () => {
  const row = await createUser({ email: `scan${Date.now()}@example.com`, name: "s", password: "password123" });
  const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(7)]);
  const req = (body: Buffer) => new Request("http://x/api/slip/scan?sport=soccer-bra&lang=pt", { method: "POST", headers: { "content-type": "image/jpeg" }, body: new Blob([new Uint8Array(body)]) });

  it("returns the read legs, writes no file, and caps a free account at 3 a day", async () => {
    sessionUser = toPublic(findById(row.id)!);
    const before = listFiles(DIR).filter((f) => !/betmatic\.db/.test(f));
    const res = await POST(req(jpeg()));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.scan.legs).toHaveLength(2);
    expect(j.scan.legs[0]).toMatchObject({ gameId: "202", settlement: { type: "moneyline" } });
    expect(j.checks[0]).toMatchObject({ kind: "product", ok: false });
    expect(listFiles(DIR).filter((f) => !/betmatic\.db/.test(f))).toEqual(before);
    expect((await POST(req(jpeg()))).status).toBe(200);
    expect((await POST(req(jpeg()))).status).toBe(200);
    const capped = await POST(req(jpeg()));
    expect(capped.status).toBe(403);
    expect((await capped.json()).error).toBe("scan_cap");
  });

  it("refuses non-images and oversized bodies before any model call", async () => {
    sessionUser = toPublic(findById(row.id)!);
    expect((await POST(req(Buffer.from("GIF89a not allowed")))).status).toBe(415);
    const big = new Request("http://x/api/slip/scan?sport=soccer-bra", { method: "POST", headers: { "content-length": String(2_000_000) }, body: new Blob([new Uint8Array(jpeg())]) });
    expect((await POST(big)).status).toBe(413);
  });
});
