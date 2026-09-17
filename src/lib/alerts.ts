import { ticketSlug } from "@/lib/ledger/proof";
import { scrubSuggestion, scrubText } from "@/lib/server/whitelabel";
import { formatDecimal } from "@/lib/odds";
import type { Lang } from "@/lib/i18n";
import type { BetSuggestion } from "@/lib/types";

/**
 * Pure rules behind alerts: link codes, the bot command, who follows a game, and the exact text a
 * follower receives. Nothing here touches the database or the network, so every rule is testable
 * without a bot — the server module (server/telegram.ts) is a thin shell around these.
 */

/** No 0/O or 1/I: the code is typed by hand into a chat on a phone. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 8;
export const LINK_CODE_TTL_MS = 15 * 60_000;

/** Maps random bytes onto the alphabet; the caller supplies the entropy so this stays deterministic under test. */
export function newLinkCode(bytes: Uint8Array): string {
  if (bytes.length < LINK_CODE_LENGTH) throw new Error(`need ${LINK_CODE_LENGTH} random bytes`);
  let out = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export const codeIsLive = (expiresAt: string | null | undefined, now = Date.now()): boolean =>
  !!expiresAt && Date.parse(expiresAt) > now;

/** `/start ABCD2345`, also `/start@BotName ABCD2345`; the deep link sends exactly this. */
export function parseStartCommand(text: string | undefined | null): string | null {
  if (!text) return null;
  const m = text.trim().match(/^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,12})\s*$/i);
  return m ? m[1].toUpperCase() : null;
}

export type FollowKind = "team" | "league";
export interface FollowRef { userId: string; kind: FollowKind; sportKey: string; key: string }

/** A game reaches whoever follows its league or either of its teams — once per user. */
export function matchFollowers(follows: FollowRef[], target: { sportKey: string; teamIds: string[] }): string[] {
  const teams = new Set(target.teamIds.filter(Boolean));
  const out = new Set<string>();
  for (const f of follows) {
    if (f.sportKey !== target.sportKey) continue;
    if (f.kind === "league" || (f.kind === "team" && teams.has(f.key))) out.add(f.userId);
  }
  return [...out];
}

const NOT_INVESTMENT: Record<Lang, string> = {
  pt: "Aposta não é investimento. Confira a linha na sua casa antes de apostar.",
  en: "Betting is not investing. Check the line at your book before you stake anything.",
};

export interface TicketAlertArgs {
  gameId: string;
  matchup: string;
  lang: Lang;
  /** The language the ledger was written in: permalink slugs are derived from these selections. */
  primary: BetSuggestion[];
  /** The same tickets rewritten for `lang`, matched by id; falls back to the primary text. */
  localised?: BetSuggestion[];
  base: string;
  max?: number;
}

/** The DM a follower gets when a game's tickets land. Whitelabelled: the reader never learns the sources. */
export function ticketAlertText(args: TicketAlertArgs): { text: string; slugs: string[] } {
  const { lang, base } = args;
  const byId = new Map((args.localised ?? []).map((s) => [s.id, s]));
  const top = [...args.primary].sort((a, b) => b.evidenceScore - a.evidenceScore).slice(0, args.max ?? 3);
  const slugs: string[] = [];
  const lines = top.map((p) => {
    const slug = ticketSlug(`${args.gameId}:${p.bandKey}:${p.legs.map((l) => l.selection).join("|")}`);
    slugs.push(slug);
    const s = scrubSuggestion(byId.get(p.id) ?? p, lang);
    return `• ${s.title} — ${formatDecimal(s.combinedDecimal)} (${lang === "pt" ? "confiança" : "confidence"} ${s.evidenceScore})\n  ${s.legs.map((l) => l.selection).join(" + ")}\n  ${base}/p/${slug}?lang=${lang}`;
  });
  const head = lang === "pt" ? `🎫 Bilhetes novos — ${scrubText(args.matchup, lang)}` : `🎫 New tickets — ${scrubText(args.matchup, lang)}`;
  return { text: [head, ...lines, "", NOT_INVESTMENT[lang]].join("\n"), slugs };
}

/**
 * What a follower hears when none of the new tickets is open to their plan yet (the free delay, a
 * band or sport outside the plan, a game they did not pick today): that the game has tickets, no picks.
 */
export function ticketNoticeText(args: { matchup: string; lang: Lang; url: string }): string {
  const matchup = scrubText(args.matchup, args.lang);
  const line = args.lang === "pt"
    ? `🎫 ${matchup} ganhou bilhetes novos. Os que o seu plano mostra aparecem na página do jogo.`
    : `🎫 ${matchup} has new tickets. The ones your plan shows are on the game page.`;
  return [line, args.url, "", NOT_INVESTMENT[args.lang]].join("\n");
}

export interface DigestItem { matchup: string; title: string; odds: number; slug: string; evidenceScore: number }

/** The morning digest: one line per game, best-evidenced ticket first. */
export function digestText(args: { lang: Lang; dateLabel: string; items: DigestItem[]; base: string }): string {
  const { lang, base } = args;
  const head = lang === "pt" ? `☀️ Seus bilhetes de hoje — ${args.dateLabel}` : `☀️ Your tickets for today — ${args.dateLabel}`;
  const lines = [...args.items].sort((a, b) => b.evidenceScore - a.evidenceScore).map((i) =>
    `• ${scrubText(i.matchup, lang)}: ${scrubText(i.title, lang)} — ${formatDecimal(i.odds)}\n  ${base}/p/${i.slug}?lang=${lang}`,
  );
  return [head, ...lines, "", NOT_INVESTMENT[lang]].join("\n");
}

export const BOT_REPLY: Record<"linked" | "badCode" | "unlinked" | "help", Record<Lang, string>> = {
  linked: {
    pt: "✅ Conta conectada. Os bilhetes dos times e ligas que você segue chegam aqui assim que saem. Mande /stop para desconectar.",
    en: "✅ Account connected. Tickets for the teams and leagues you follow land here the moment they are built. Send /stop to disconnect.",
  },
  badCode: {
    pt: "Esse código não vale mais. Gere outro em Alertas dentro do Betmatic e mande /start com ele.",
    en: "That code is no longer valid. Generate a new one under Alerts in Betmatic and send /start with it.",
  },
  unlinked: { pt: "Desconectado. Você pode conectar de novo quando quiser.", en: "Disconnected. You can connect again whenever you like." },
  help: {
    pt: "Para conectar, abra Alertas no Betmatic, copie o código e mande /start CÓDIGO aqui.",
    en: "To connect, open Alerts in Betmatic, copy the code and send /start CODE here.",
  },
};

/** The cron ticks all day; the digest goes out once, the first tick at or after `hour` in São Paulo. */
export function digestDue(now: Date, hour = 9): boolean {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false }).format(now)) % 24;
  return h >= hour;
}
