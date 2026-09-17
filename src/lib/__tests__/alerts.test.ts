import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { BetSuggestion } from "@/lib/types";

const DIR = path.join(process.cwd(), "data", "unit-alerts");
process.env.DATA_DIR = DIR; process.env.AUTH_SECRET = "test-secret-that-is-long-enough"; process.env.TELEGRAM_BOT_TOKEN = "unit-token"; process.env.TELEGRAM_BOT_USERNAME = "betmatic_bot";
fs.rmSync(DIR, { recursive: true, force: true });
const { newLinkCode, parseStartCommand, matchFollowers, ticketAlertText, digestText, digestDue, codeIsLive, LINK_CODE_TTL_MS } = await import("@/lib/alerts");
const tg = await import("@/lib/server/telegram");
const { createUser, setPlanByAdmin } = await import("@/lib/server/users");
const { dayKeyFor } = await import("@/lib/server/unlocks");
const { savePrediction } = await import("@/lib/server/predictions");
const { getDb } = await import("@/lib/server/db");

const s = (id: string, title: string, score: number, legs = ["Sevilha vence"]): BetSuggestion => ({
  id, kind: legs.length > 1 ? "parlay" : "single", bandKey: "value", title, background: "Preço lido na Betano.", legs: legs.map((l) => ({ selection: l, market: "moneyline", odds: "2.00", oddsDecimal: 2, book: "Betano", explanation: "x", evidence: "Gamelog ESPN", fairProbability: 0.5 })),
  combinedDecimal: 2, combinedAmerican: "+100", impliedProbability: 0.5, modelledProbability: 0.5, edgePct: 0, riskNote: "", confidence: "medium", evidenceScore: score, evidenceNotes: [],
});

describe("alert rules", () => {
  it("link codes use the confusion-free alphabet and are deterministic for the same entropy", () => {
    const bytes = new Uint8Array([0, 1, 2, 31, 32, 255, 7, 8]);
    expect(newLinkCode(bytes)).toBe("ABC9A9HJ");
    expect(newLinkCode(bytes)).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(() => newLinkCode(new Uint8Array(3))).toThrow();
    expect(codeIsLive(new Date(Date.now() + 1000).toISOString())).toBe(true);
    expect(codeIsLive(new Date(Date.now() - 1000).toISOString())).toBe(false);
    expect(codeIsLive(null)).toBe(false);
    expect(LINK_CODE_TTL_MS).toBe(15 * 60_000);
  });
  it("parses /start with a code, including the @bot form, and nothing else", () => {
    expect(parseStartCommand("/start abcd2345")).toBe("ABCD2345");
    expect(parseStartCommand("/start@BetmaticBot ABCD2345")).toBe("ABCD2345");
    expect(parseStartCommand("  /start ABCD2345 ")).toBe("ABCD2345");
    expect(parseStartCommand("/start")).toBeNull();
    expect(parseStartCommand("/stop ABCD2345")).toBeNull();
    expect(parseStartCommand("hello")).toBeNull();
    expect(parseStartCommand(undefined)).toBeNull();
  });
  it("matches followers of the league or of either team, once per user, never across sports", () => {
    const follows = [
      { userId: "u1", kind: "league" as const, sportKey: "soccer-esp", key: "soccer-esp" },
      { userId: "u2", kind: "team" as const, sportKey: "soccer-esp", key: "243" },
      { userId: "u2", kind: "team" as const, sportKey: "soccer-esp", key: "94" },
      { userId: "u3", kind: "team" as const, sportKey: "nba", key: "243" },
      { userId: "u4", kind: "team" as const, sportKey: "soccer-esp", key: "999" },
    ];
    expect(matchFollowers(follows, { sportKey: "soccer-esp", teamIds: ["243", "94"] }).sort()).toEqual(["u1", "u2"]);
    expect(matchFollowers(follows, { sportKey: "nba", teamIds: ["243"] })).toEqual(["u3"]);
    expect(matchFollowers(follows, { sportKey: "tennis-atp", teamIds: [] })).toEqual([]);
  });
  it("writes the DM with the best tickets, permalinks and no source names, in the reader's language", () => {
    const primary = [s("a", "Sevilha vence", 40), s("b", "Jogo aberto", 90, ["Mais de 2,5 gols", "Ambas marcam"]), s("c", "Agoumé faz falta", 70), s("d", "x", 10)];
    const localised = [{ ...s("b", "Open game", 90, ["Over 2.5 goals", "Both teams score"]) }];
    const pt = ticketAlertText({ gameId: "g1", matchup: "Valencia @ Sevilla", lang: "pt", primary, base: "https://x.y" });
    expect(pt.text).toContain("Bilhetes novos — Valencia @ Sevilla");
    expect(pt.text.split("\n").filter((l) => l.startsWith("• ")).map((l) => l.slice(2).split(" — ")[0])).toEqual(["Jogo aberto", "Agoumé faz falta", "Sevilha vence"]);
    expect(pt.slugs).toHaveLength(3);
    expect(pt.text).toContain(`https://x.y/p/${pt.slugs[0]}?lang=pt`);
    expect(pt.text).not.toMatch(/Betano|ESPN/);
    const en = ticketAlertText({ gameId: "g1", matchup: "Valencia @ Sevilla", lang: "en", primary, localised, base: "https://x.y" });
    expect(en.text).toContain("New tickets");
    expect(en.text).toContain("Open game");
    expect(en.text).toContain("Over 2.5 goals + Both teams score");
    // the permalink still comes from the ledger's (primary-language) selections
    expect(en.slugs[0]).toBe(pt.slugs[0]);
    expect(en.text).toContain("Betting is not investing");
  });
  it("digest text sorts by evidence and carries the responsible-gambling line", () => {
    const text = digestText({ lang: "pt", dateLabel: "17/09/2026", base: "https://x.y", items: [{ matchup: "A @ B", title: "t1", odds: 2, slug: "s1", evidenceScore: 50 }, { matchup: "C @ D", title: "t2 na Betano", odds: 3.5, slug: "s2", evidenceScore: 80 }] });
    expect(text.indexOf("C @ D")).toBeLessThan(text.indexOf("A @ B"));
    expect(text).toContain("Seus bilhetes de hoje — 17/09/2026");
    expect(text).toContain("https://x.y/p/s2?lang=pt");
    expect(text).not.toMatch(/Betano/);
    expect(text).toContain("Aposta não é investimento");
  });
  it("the digest gate follows São Paulo time", () => {
    // 11:00Z is 08:00 in São Paulo (UTC-3) and 13:00Z is 10:00.
    expect(digestDue(new Date("2026-09-17T11:00:00Z"), 9)).toBe(false);
    expect(digestDue(new Date("2026-09-17T13:00:00Z"), 9)).toBe(true);
  });
});

const alice = await createUser({ email: "alice@x.com", name: "Alice", password: "password123", lang: "pt" });
const bob = await createUser({ email: "bob@x.com", name: "Bob", password: "password123", lang: "en" });

describe("telegram link flow", () => {
  const sent: { chatId: string; text: string }[] = [];
  const capture = () => tg.setTelegramTransport(async (chatId, text) => { sent.push({ chatId, text }); return { ok: true }; });
  capture();
  beforeEach(capture);

  it("issues a one-time code, the bot consumes it once, and the account is linked", async () => {
    const status = tg.issueLinkCode(alice.id);
    expect(status.linked).toBe(false);
    expect(status.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(status.deepLink).toBe(`https://t.me/betmatic_bot?start=${status.code}`);
    const bad = await tg.handleTelegramUpdate({ message: { chat: { id: 100 }, from: { language_code: "pt-br" }, text: "/start NOPE1234" } });
    expect(bad.action).toBe("badCode");
    expect(sent.at(-1)?.text).toContain("não vale mais");
    const ok = await tg.handleTelegramUpdate({ message: { chat: { id: 100 }, from: { username: "alice_tg" }, text: `/start ${status.code}` } });
    expect(ok).toEqual({ action: "linked", userId: alice.id });
    expect(sent.at(-1)).toEqual({ chatId: "100", text: expect.stringContaining("Conta conectada") });
    const after = tg.linkStatus(alice.id);
    expect(after).toMatchObject({ linked: true, username: "alice_tg", code: null, digest: true });
    // the code is spent
    expect((await tg.handleTelegramUpdate({ message: { chat: { id: 101 }, text: `/start ${status.code}` } })).action).toBe("badCode");
    // a linked account asking for a code keeps its link
    expect(tg.issueLinkCode(alice.id).linked).toBe(true);
  });
  it("/stop unlinks, anything else gets help, and an empty update is ignored", async () => {
    expect((await tg.handleTelegramUpdate({ message: { chat: { id: 100 }, text: "oi" } })).action).toBe("help");
    expect((await tg.handleTelegramUpdate({})).action).toBe("ignored");
    expect((await tg.handleTelegramUpdate({ message: { chat: { id: 100 }, text: "/stop" } })).action).toBe("unlinked");
    expect(tg.linkStatus(alice.id).linked).toBe(false);
    // relink for the delivery tests below
    const code = tg.issueLinkCode(alice.id).code!;
    expect((await tg.handleTelegramUpdate({ message: { chat: { id: 100 }, from: { username: "alice_tg" }, text: `/start ${code}` } })).action).toBe("linked");
  });
  it("delivers to Telegram when linked, to the in-app list otherwise, and never twice for one key", async () => {
    sent.length = 0;
    expect(await tg.deliver({ userId: alice.id, kind: "system", dedupeKey: "k1", title: "t", body: "hello alice", url: "" })).toBe("telegram");
    expect(await tg.deliver({ userId: alice.id, kind: "system", dedupeKey: "k1", title: "t", body: "hello alice", url: "" })).toBeNull();
    expect(sent).toEqual([{ chatId: "100", text: "hello alice" }]);
    expect(await tg.deliver({ userId: bob.id, kind: "system", dedupeKey: "k1", title: "t", body: "hello bob", url: "" })).toBe("inapp");
    expect(tg.listNotifications(bob.id).map((n) => [n.channel, n.status, n.body])).toEqual([["inapp", "unread", "hello bob"]]);
    expect(tg.unreadCount(bob.id)).toBe(1);
    expect(tg.markNotificationsRead(bob.id, null)).toBe(1);
    expect(tg.unreadCount(bob.id)).toBe(0);
    // a failed send lands in the in-app list instead of vanishing
    tg.setTelegramTransport(async () => ({ ok: false, error: "boom" }));
    expect(await tg.deliver({ userId: alice.id, kind: "system", dedupeKey: "k2", title: "t", body: "fallback", url: "" })).toBe("inapp");
    expect(tg.listNotifications(alice.id)[0]).toMatchObject({ channel: "inapp", status: "unread", error: "boom" });
  });
  it("notifies league and team followers in their own language, whitelabelled, once per game, within each plan", async () => {
    sent.length = 0;
    expect(tg.follow(alice.id, { kind: "league", sportKey: "soccer-esp", key: "", label: "" })).toBe(true);
    expect(tg.follow(bob.id, { kind: "team", sportKey: "soccer-esp", key: "243", label: "Sevilla" })).toBe(true);
    expect(tg.follow(bob.id, { kind: "team", sportKey: "nope", key: "1", label: "" })).toBe(false);
    expect(tg.listFollows(bob.id)).toHaveLength(1);
    // bob pays for Pro; alice stays on the free plan (value band only, two-hour delay, one chosen game)
    setPlanByAdmin(bob.id, "pro", new Date(Date.now() + 30 * 86_400_000).toISOString());
    const safe = { ...s("b", "Sevilha segura", 90, ["Sevilha dupla chance"]), bandKey: "safe" };
    const slates = {
      pt: { suggestions: [s("a", "Sevilha vence", 60), safe], dataNote: "" },
      en: { suggestions: [s("a", "Sevilla to win", 60), { ...safe, title: "Sevilla safe" }], dataNote: "" },
    };
    for (const lang of ["pt", "en"] as const) savePrediction({ scope: "game", sportKey: "soccer-esp", gameId: "g9", dateKey: "20260917", lang, matchup: "Valencia @ Sevilla", startsAt: new Date(Date.now() + 6 * 3_600_000).toISOString(), slate: slates[lang] });
    const args = { gameId: "g9", sportKey: "soccer-esp", matchup: "Valencia @ Sevilla", teamIds: ["243", "94"], dateKey: "20260917", primary: "pt" as const, slates, base: "https://x.y" };
    const r = await tg.notifyFollowers(args);
    expect(r).toEqual({ users: 2, telegram: 1, inapp: 1 });
    expect(sent).toHaveLength(1);
    // alice's plan shows none of these tickets yet: she hears that the game has tickets, and no pick
    expect(sent[0].text).toContain("ganhou bilhetes novos");
    expect(sent[0].text).not.toMatch(/Sevilha vence|segura|dupla chance|Betano|ESPN/);
    expect(sent[0].text).toContain("https://x.y/app/game/g9?sport=soccer-esp&lang=pt");
    const bobs = tg.listNotifications(bob.id).filter((n) => n.kind === "tickets");
    expect(bobs).toHaveLength(1);
    expect(bobs[0].body).toContain("Sevilla to win");
    expect(bobs[0].body).toContain("Sevilla safe");
    expect(bobs[0].body).not.toMatch(/Betano|ESPN/);
    expect(bobs[0].url).toMatch(/https:\/\/x\.y\/p\/[0-9a-f]{10}\?lang=en/);
    // regeneration of the same game is silent
    expect(await tg.notifyFollowers(args)).toEqual({ users: 0, telegram: 0, inapp: 0 });
    // once the free delay has passed and alice picked this game, she reads the value ticket and never the safe one
    getDb().prepare("UPDATE predictions SET generatedAt=? WHERE gameId='g9'").run(new Date(Date.now() - 3 * 3_600_000).toISOString());
    getDb().prepare("INSERT INTO user_game_unlocks (userId, dayKey, gameId, sportKey, createdAt) VALUES (?,?,?,?,?)").run(alice.id, dayKeyFor(), "g9", "soccer-esp", new Date().toISOString());
    sent.length = 0;
    getDb().prepare("DELETE FROM alert_log WHERE userId=? AND kind='tickets'").run(alice.id);
    expect(await tg.notifyFollowers(args)).toMatchObject({ users: 1, telegram: 1 });
    expect(sent[0].text).toContain("Sevilha vence");
    expect(sent[0].text).not.toMatch(/segura|dupla chance/);
    getDb().prepare("DELETE FROM predictions WHERE gameId='g9'").run();
    getDb().prepare("DELETE FROM user_game_unlocks WHERE userId=?").run(alice.id);
    setPlanByAdmin(bob.id, "free", null);
    expect(tg.unfollow(bob.id, "team", "soccer-esp", "243")).toBe(true);
    expect(tg.listFollows(bob.id)).toHaveLength(0);
  });
  it("sends the daily digest once per day, within the plan, and only when there is something to say", async () => {
    sent.length = 0;
    savePrediction({ scope: "game", sportKey: "soccer-esp", gameId: "g7", dateKey: "20260917", lang: "pt", matchup: "Valencia @ Sevilla", slate: { suggestions: [s("a", "Sevilha vence", 60), s("b", "Múltipla", 80, ["x", "y"])], dataNote: "" } });
    // the free plan reads tickets on a two-hour delay: a just-built game is invisible to it, an overnight one is not
    getDb().prepare("UPDATE predictions SET generatedAt=? WHERE gameId='g7'").run(new Date(Date.now() - 3 * 3_600_000).toISOString());
    // bob opts in without ever linking a chat: his digest goes to the in-app list
    tg.setDigest(bob.id, true);
    const gated = await tg.sendDailyDigest({ dateKey: "20260917", base: "https://x.y", now: new Date("2026-09-17T03:00:00Z") });
    expect(gated.note).toBe("before digest hour");
    const r = await tg.sendDailyDigest({ dateKey: "20260917", base: "https://x.y", force: true });
    // alice (free plan, linked) gets Telegram; bob (free, not linked) gets the in-app list; admin has no link row
    expect(r).toMatchObject({ users: 2, telegram: 1, inapp: 1 });
    expect(sent[0].text).toContain("Seus bilhetes de hoje");
    // the free plan only sees the value band; the two seeded tickets are both "value", the best-evidenced one leads
    expect(sent[0].text).toContain("Múltipla");
    expect(sent[0].text).not.toMatch(/Betano|ESPN/);
    expect(await tg.sendDailyDigest({ dateKey: "20260917", base: "https://x.y", force: true })).toMatchObject({ users: 0, skipped: 2 });
    expect(await tg.sendDailyDigest({ dateKey: "20260918", base: "https://x.y", force: true })).toMatchObject({ users: 0, skipped: 2 });
    tg.setDigest(bob.id, false);
    expect(tg.linkStatus(bob.id).digest).toBe(false);
    expect(tg.alertStats()).toMatchObject({ linked: 1, follows: 1 });
  });
});
