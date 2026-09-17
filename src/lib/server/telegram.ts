import fs from "node:fs";
import { envValue } from "@/lib/env";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { getDb, newId, nowIso } from "@/lib/server/db";
import { findById, toPublic } from "@/lib/server/users";
import { findPrediction, servePredictions } from "@/lib/server/predictions";
import { refreshConfig } from "@/lib/server/refresh-policy";
import { scrubText } from "@/lib/server/whitelabel";
import { ticketSlug } from "@/lib/ledger/proof";
import { SPORTS } from "@/lib/sports";
import { todayKey } from "@/lib/sources/espn";
import { normaliseLang, type Lang } from "@/lib/i18n";
import {
  BOT_REPLY, LINK_CODE_LENGTH, LINK_CODE_TTL_MS, codeIsLive, digestDue, digestText, matchFollowers, newLinkCode,
  parseStartCommand, ticketAlertText, type DigestItem, type FollowKind, type FollowRef,
} from "@/lib/alerts";
import type { BetSlate, BetSuggestion } from "@/lib/types";
import { baseUrlOrEmpty } from "@/lib/base-url";

/**
 * Telegram alerts. The bot only ever receives `/start <code>` and `/stop`; everything else is
 * outbound. Delivery is one function (`deliver`) so the fallback is uniform: a user without a
 * linked chat — or a send that fails — gets the same message in the in-app list instead.
 */
export type TelegramTransport = (chatId: string, text: string) => Promise<{ ok: boolean; error?: string }>;

export const telegramConfigured = (): boolean => !!envValue("TELEGRAM_BOT_TOKEN");
export const botUsername = (): string => envValue("TELEGRAM_BOT_USERNAME").replace(/^@/, "");
export const deepLinkFor = (code: string): string | null => (botUsername() ? `https://t.me/${botUsername()}?start=${code}` : null);

const outboxFile = () => path.join(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), "telegram-outbox.jsonl");

/** Test transport: messages are appended to a file under DATA_DIR and never leave the machine. */
const fileTransport: TelegramTransport = async (chatId, text) => {
  fs.mkdirSync(path.dirname(outboxFile()), { recursive: true });
  fs.appendFileSync(outboxFile(), JSON.stringify({ chatId, text, at: new Date().toISOString() }) + "\n");
  return { ok: true };
};

const botApiTransport: TelegramTransport = async (chatId, text) => {
  const token = envValue("TELEGRAM_BOT_TOKEN");
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
  try {
    // Plain text on purpose: Markdown escaping of team names and odds is a bug factory.
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(8000),
    });
    return r.ok ? { ok: true } : { ok: false, error: `telegram ${r.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "send failed" };
  }
};

let override: TelegramTransport | null = null;
/** Unit tests swap the transport; e2e uses TELEGRAM_TRANSPORT=file instead. */
export function setTelegramTransport(t: TelegramTransport | null): void { override = t; }
export const sendTelegram: TelegramTransport = (chatId, text) =>
  (override ?? (process.env.TELEGRAM_TRANSPORT === "file" ? fileTransport : botApiTransport))(chatId, text);

// ---- link codes -------------------------------------------------------------------------------

export interface TelegramLinkRow {
  userId: string; code: string | null; codeExpiresAt: string | null; chatId: string | null; username: string;
  linkedAt: string | null; digest: number; createdAt: string;
}
export interface LinkStatus {
  configured: boolean; linked: boolean; username: string; digest: boolean;
  code: string | null; codeExpiresAt: string | null; deepLink: string | null; botUsername: string;
}

const getRow = (userId: string) => getDb().prepare("SELECT * FROM telegram_links WHERE userId=?").get(userId) as TelegramLinkRow | undefined;

function ensureRow(userId: string): TelegramLinkRow {
  const existing = getRow(userId);
  if (existing) return existing;
  getDb().prepare("INSERT INTO telegram_links (userId, createdAt) VALUES (?,?)").run(userId, nowIso());
  return getRow(userId)!;
}

export function linkStatus(userId: string): LinkStatus {
  const row = getRow(userId);
  const code = row?.code && codeIsLive(row.codeExpiresAt) ? row.code : null;
  return {
    configured: telegramConfigured(), linked: !!row?.chatId, username: row?.username ?? "", digest: (row?.digest ?? 1) === 1,
    code, codeExpiresAt: code ? row!.codeExpiresAt : null, deepLink: code ? deepLinkFor(code) : null, botUsername: botUsername(),
  };
}

/** A fresh one-time code; a linked account keeps its link and gets no code. */
export function issueLinkCode(userId: string): LinkStatus {
  const row = ensureRow(userId);
  if (row.chatId) return linkStatus(userId);
  const expires = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      getDb().prepare("UPDATE telegram_links SET code=?, codeExpiresAt=? WHERE userId=?").run(newLinkCode(randomBytes(LINK_CODE_LENGTH)), expires, userId);
      return linkStatus(userId);
    } catch (error) {
      // UNIQUE(code) collision: 32^8 codes make this a formality, but a retry costs nothing.
      if (attempt === 4) throw error;
    }
  }
  return linkStatus(userId);
}

export function consumeLinkCode(code: string, chatId: string, username: string): { userId: string } | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM telegram_links WHERE code=?").get(code.toUpperCase()) as TelegramLinkRow | undefined;
  if (!row || !codeIsLive(row.codeExpiresAt)) return null;
  db.transaction(() => {
    // One chat, one account: linking here releases the same chat from any other user.
    db.prepare("UPDATE telegram_links SET chatId=NULL, linkedAt=NULL WHERE chatId=? AND userId<>?").run(chatId, row.userId);
    db.prepare("UPDATE telegram_links SET chatId=?, username=?, linkedAt=?, code=NULL, codeExpiresAt=NULL WHERE userId=?").run(chatId, username, nowIso(), row.userId);
  })();
  return { userId: row.userId };
}

export function unlinkTelegram(userId: string): boolean {
  return getDb().prepare("UPDATE telegram_links SET chatId=NULL, username='', linkedAt=NULL WHERE userId=? AND chatId IS NOT NULL").run(userId).changes > 0;
}

function unlinkChat(chatId: string): string[] {
  const db = getDb();
  const users = (db.prepare("SELECT userId FROM telegram_links WHERE chatId=?").all(chatId) as { userId: string }[]).map((r) => r.userId);
  db.prepare("UPDATE telegram_links SET chatId=NULL, username='', linkedAt=NULL WHERE chatId=?").run(chatId);
  return users;
}

export function setDigest(userId: string, on: boolean): void {
  ensureRow(userId);
  getDb().prepare("UPDATE telegram_links SET digest=? WHERE userId=?").run(on ? 1 : 0, userId);
}

// ---- inbound: the bot webhook -------------------------------------------------------------------

export interface TelegramUpdate {
  message?: { chat?: { id?: number | string }; from?: { username?: string; language_code?: string }; text?: string };
}
export type BotAction = "linked" | "badCode" | "unlinked" | "help" | "ignored";

export async function handleTelegramUpdate(update: TelegramUpdate, send: TelegramTransport = sendTelegram): Promise<{ action: BotAction; userId?: string }> {
  const msg = update.message;
  const text = msg?.text?.trim() ?? "";
  if (msg?.chat?.id === undefined || msg.chat.id === null || !text) return { action: "ignored" };
  const chat = String(msg.chat.id);
  // Before the account is known, Telegram's own language hint picks the reply language.
  const langOf = (userId?: string): Lang =>
    normaliseLang(userId ? findById(userId)?.lang : msg.from?.language_code?.toLowerCase().startsWith("pt") ? "pt" : "en");

  const code = parseStartCommand(text);
  if (code) {
    const linked = consumeLinkCode(code, chat, msg.from?.username ?? "");
    if (linked) { await send(chat, BOT_REPLY.linked[langOf(linked.userId)]); return { action: "linked", userId: linked.userId }; }
    await send(chat, BOT_REPLY.badCode[langOf()]);
    return { action: "badCode" };
  }
  if (/^\/stop\b/i.test(text)) {
    const users = unlinkChat(chat);
    await send(chat, BOT_REPLY.unlinked[langOf(users[0])]);
    return { action: "unlinked", userId: users[0] };
  }
  await send(chat, BOT_REPLY.help[langOf()]);
  return { action: "help" };
}

// ---- follows ------------------------------------------------------------------------------------

export interface FollowRow extends FollowRef { label: string; createdAt: string }

export function listFollows(userId: string): FollowRow[] {
  return getDb().prepare("SELECT userId, kind, sportKey, key, label, createdAt FROM follows WHERE userId=? ORDER BY createdAt").all(userId) as FollowRow[];
}

export function follow(userId: string, f: { kind: FollowKind; sportKey: string; key: string; label: string }): boolean {
  if (!SPORTS.some((s) => s.key === f.sportKey)) return false;
  const key = f.kind === "league" ? f.sportKey : f.key.trim();
  if (!key) return false;
  const label = f.kind === "league" ? SPORTS.find((s) => s.key === f.sportKey)!.label.pt : f.label.trim().slice(0, 80);
  getDb().prepare("INSERT OR IGNORE INTO follows (userId, kind, sportKey, key, label, createdAt) VALUES (?,?,?,?,?,?)").run(userId, f.kind, f.sportKey, key, label, nowIso());
  return true;
}

export function unfollow(userId: string, kind: FollowKind, sportKey: string, key: string): boolean {
  return getDb().prepare("DELETE FROM follows WHERE userId=? AND kind=? AND sportKey=? AND key=?").run(userId, kind, sportKey, kind === "league" ? sportKey : key).changes > 0;
}

export function followersOf(sportKey: string, teamIds: string[]): string[] {
  const rows = getDb().prepare("SELECT userId, kind, sportKey, key FROM follows WHERE sportKey=?").all(sportKey) as FollowRef[];
  return matchFollowers(rows, { sportKey, teamIds });
}

// ---- alert log + delivery -----------------------------------------------------------------------

export interface AlertRow {
  id: string; channel: "telegram" | "inapp"; kind: "tickets" | "digest" | "system"; dedupeKey: string;
  title: string; body: string; url: string; status: "sent" | "failed" | "unread" | "read"; error: string; createdAt: string; readAt: string | null;
}
export interface DeliverArgs { userId: string; kind: AlertRow["kind"]; dedupeKey: string; title: string; body: string; url: string }

/**
 * Telegram when a chat is linked, the in-app list otherwise — and the in-app list again when the
 * send fails, so a Telegram outage never swallows an alert. Returns null when the dedupe key was
 * already claimed (a regenerated game must not alert twice).
 */
export async function deliver(args: DeliverArgs, send: TelegramTransport = sendTelegram): Promise<"telegram" | "inapp" | null> {
  const db = getDb();
  const chat = telegramConfigured() ? getRow(args.userId)?.chatId ?? null : null;
  const id = newId("al");
  const claimed = db.prepare(
    "INSERT OR IGNORE INTO alert_log (id,userId,channel,kind,dedupeKey,title,body,url,status,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(id, args.userId, chat ? "telegram" : "inapp", args.kind, args.dedupeKey, args.title, args.body, args.url, chat ? "sent" : "unread", nowIso()).changes > 0;
  if (!claimed) return null;
  if (!chat) return "inapp";
  const r = await send(chat, args.body);
  if (r.ok) return "telegram";
  db.prepare("UPDATE alert_log SET channel='inapp', status='unread', error=? WHERE id=?").run(r.error ?? "send failed", id);
  return "inapp";
}

export function listNotifications(userId: string, limit = 30): AlertRow[] {
  return getDb().prepare(
    "SELECT id, channel, kind, dedupeKey, title, body, url, status, error, createdAt, readAt FROM alert_log WHERE userId=? ORDER BY createdAt DESC, rowid DESC LIMIT ?",
  ).all(userId, limit) as AlertRow[];
}

export function unreadCount(userId: string): number {
  return (getDb().prepare("SELECT COUNT(*) n FROM alert_log WHERE userId=? AND status='unread'").get(userId) as { n: number }).n;
}

export function markNotificationsRead(userId: string, ids: string[] | null): number {
  const db = getDb();
  if (!ids) return db.prepare("UPDATE alert_log SET status='read', readAt=? WHERE userId=? AND status='unread'").run(nowIso(), userId).changes;
  let n = 0;
  for (const id of ids) n += db.prepare("UPDATE alert_log SET status='read', readAt=? WHERE userId=? AND id=? AND status='unread'").run(nowIso(), userId, id).changes;
  return n;
}

// ---- outbound: new tickets and the daily digest ----------------------------------------------------

export interface NotifyArgs {
  gameId: string; sportKey: string; matchup: string; teamIds: string[];
  primary: Lang; slates: Partial<Record<Lang, BetSlate>>; base: string;
}

/** Called right after a game's tickets are saved. Each follower hears once, in their own language. */
export async function notifyFollowers(args: NotifyArgs, send: TelegramTransport = sendTelegram): Promise<{ users: number; telegram: number; inapp: number }> {
  const out = { users: 0, telegram: 0, inapp: 0 };
  const primarySlate = args.slates[args.primary];
  if (!primarySlate?.suggestions.length) return out;
  for (const userId of followersOf(args.sportKey, args.teamIds)) {
    const user = findById(userId);
    if (!user) continue;
    const lang = normaliseLang(user.lang);
    const { text, slugs } = ticketAlertText({ gameId: args.gameId, matchup: args.matchup, lang, primary: primarySlate.suggestions, localised: args.slates[lang]?.suggestions, base: args.base });
    const title = scrubText(lang === "pt" ? `Bilhetes novos — ${args.matchup}` : `New tickets — ${args.matchup}`, lang);
    const where = await deliver({ userId, kind: "tickets", dedupeKey: `tickets:${args.gameId}`, title, body: text, url: `${args.base}/p/${slugs[0]}?lang=${lang}` }, send);
    if (!where) continue;
    out.users += 1;
    if (where === "telegram") out.telegram += 1; else out.inapp += 1;
  }
  return out;
}

const dateLabel = (dateKey: string, lang: Lang) =>
  lang === "pt" ? `${dateKey.slice(6, 8)}/${dateKey.slice(4, 6)}/${dateKey.slice(0, 4)}` : new Date(Date.UTC(+dateKey.slice(0, 4), +dateKey.slice(4, 6) - 1, +dateKey.slice(6, 8))).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

/** Ledger ids are written in the primary generation language; the slug must come from that text. */
function slugFor(sportKey: string, gameId: string, dateKey: string, primaryLang: Lang, shown: BetSuggestion): string {
  const raw = findPrediction({ scope: "game", sportKey, gameId, dateKey, lang: primaryLang });
  const primary = raw ? (JSON.parse(raw.payload) as BetSlate).suggestions.find((s) => s.id === shown.id) ?? shown : shown;
  return ticketSlug(`${gameId}:${primary.bandKey}:${primary.legs.map((l) => l.selection).join("|")}`);
}

/**
 * "Seus bilhetes de hoje": the best ticket of every game on today's slates, within the user's plan.
 * Runs on every cron tick and sends once per day after TELEGRAM_DIGEST_HOUR (São Paulo time);
 * `force` skips the clock for manual runs.
 */
export async function sendDailyDigest(opts: { dateKey?: string; base?: string; force?: boolean; now?: Date } = {}, send: TelegramTransport = sendTelegram) {
  const out = { users: 0, telegram: 0, inapp: 0, skipped: 0, note: "" };
  const now = opts.now ?? new Date();
  if (!opts.force && !digestDue(now, Number(process.env.TELEGRAM_DIGEST_HOUR ?? 9))) { out.note = "before digest hour"; return out; }
  const dateKey = opts.dateKey ?? todayKey();
  const base = opts.base ?? baseUrlOrEmpty();
  const primaryLang = refreshConfig(process.env, SPORTS.map((s) => s.key)).langs[0] as Lang;
  const subscribers = getDb().prepare("SELECT userId FROM telegram_links WHERE digest=1").all() as { userId: string }[];

  for (const { userId } of subscribers) {
    const row = findById(userId);
    if (!row) continue;
    const user = toPublic(row);
    const lang = normaliseLang(user.lang);
    const collect = (readLang: Lang): DigestItem[] => {
      const items: DigestItem[] = [];
      for (const sport of SPORTS) {
        for (const p of servePredictions({ scope: "game", sportKey: sport.key, dateKey, lang: readLang, plan: user.plan, role: "user" })) {
          const best = [...p.slate.suggestions].sort((a, b) => b.evidenceScore - a.evidenceScore)[0];
          if (!best || !p.gameId) continue;
          items.push({ matchup: p.matchup, title: best.title, odds: best.combinedDecimal, evidenceScore: best.evidenceScore, slug: slugFor(sport.key, p.gameId, dateKey, primaryLang, best) });
        }
      }
      return items;
    };
    // A day whose derived-language pass failed still has the primary text: better that than silence.
    let items = collect(lang);
    if (!items.length && lang !== primaryLang) items = collect(primaryLang);
    if (!items.length) { out.skipped += 1; continue; }
    const body = digestText({ lang, dateLabel: dateLabel(dateKey, lang), items: items.slice(0, 8), base });
    const title = lang === "pt" ? `Seus bilhetes de hoje — ${dateLabel(dateKey, lang)}` : `Your tickets for today — ${dateLabel(dateKey, lang)}`;
    const where = await deliver({ userId, kind: "digest", dedupeKey: `digest:${dateKey}`, title, body, url: `${base}/app?lang=${lang}` }, send);
    if (!where) { out.skipped += 1; continue; }
    out.users += 1;
    if (where === "telegram") out.telegram += 1; else out.inapp += 1;
  }
  return out;
}

/** Aggregate only — the admin panel never lists who follows what. */
export function alertStats() {
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  return {
    linked: one("SELECT COUNT(*) c FROM telegram_links WHERE chatId IS NOT NULL"),
    digest: one("SELECT COUNT(*) c FROM telegram_links WHERE digest=1"),
    follows: one("SELECT COUNT(*) c FROM follows"),
    sent: one("SELECT COUNT(*) c FROM alert_log WHERE channel='telegram' AND status='sent'"),
    inapp: one("SELECT COUNT(*) c FROM alert_log WHERE channel='inapp'"),
  };
}
