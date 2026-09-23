import nodemailer, { type Transporter } from "nodemailer";
import { readLiveLedger } from "@/lib/ledger/store";
import { findPrediction } from "@/lib/server/predictions";
import { logEvent, reportError } from "@/lib/server/ops-log";
import { formatDecimal } from "@/lib/odds";
import type { BetSlate, BetSuggestion } from "@/lib/types";

/**
 * Every ticket of a game, mailed to the operators each time a new read comes out: first every
 * pre-game ticket, then every live read so far, each with its quarter — name, lines and price only.
 * The mail is the running picture of the game, so a reader never has to open the app to know what
 * was built. Off until TICKET_EMAIL_TO and the SMTP settings exist; a failure is logged, never
 * thrown into the generation that triggered it.
 */
export interface TicketMailConfig { to: string[]; from: string; host: string; port: number; secure: boolean; user: string; pass: string }

export function ticketMailConfig(env: Record<string, string | undefined> = process.env): TicketMailConfig | null {
  const to = (env.TICKET_EMAIL_TO ?? "").split(",").map((s) => s.trim()).filter((s) => s.includes("@"));
  const host = (env.SMTP_HOST ?? "").trim();
  const user = (env.SMTP_USER ?? "").trim();
  const pass = env.SMTP_PASS ?? "";
  if (!to.length || !host || !user || !pass) return null;
  const port = Number(env.SMTP_PORT) || 465;
  return { to, from: (env.TICKET_EMAIL_FROM ?? "").trim() || user, host, port, secure: port === 465, user, pass };
}

export interface MailTicket { title: string; combinedDecimal: number; legs: { selection: string; oddsDecimal: number }[]; alternative?: boolean }
export interface MailLiveRead { period?: number; minute?: number; tickets: MailTicket[] }
export interface TicketMailInput {
  matchup: string;
  sportKey: string;
  /** What just came out: the pre-game slate, or a live read (with its quarter). */
  fresh: { kind: "pre" } | { kind: "live"; period?: number; minute?: number };
  pre: MailTicket[];
  live: MailLiveRead[];
  lang: "pt" | "en";
}

const quarterName = (period: number | undefined, lang: "pt" | "en") =>
  !period ? (lang === "pt" ? "ao vivo" : "live") : period <= 4 ? (lang === "pt" ? `${period}º quarto` : `Q${period}`) : (lang === "pt" ? "prorrogação" : "overtime");

/** Subject, plain text and HTML for one game's running picture. Pure, so it is unit-tested. */
export function renderTicketMail(input: TicketMailInput): { subject: string; text: string; html: string } {
  const { lang } = input;
  const freshLabel = input.fresh.kind === "pre" ? (lang === "pt" ? "pré-jogo" : "pre-game") : quarterName(input.fresh.period, lang);
  const subject = `[Betmatic] ${input.matchup} — ${lang === "pt" ? "novo" : "new"}: ${freshLabel}`;
  // formatDecimal already carries the "x".
  const price = (n: number) => formatDecimal(n, lang);
  const line = (t: MailTicket) => {
    const legs = t.legs.map((l) => `  - ${l.selection} @ ${formatDecimal(l.oddsDecimal, lang)}`).join("\n");
    const alt = t.alternative ? (lang === "pt" ? " (alternativa)" : " (alternative)") : "";
    return `${t.title}${alt} — ${price(t.combinedDecimal)}\n${legs}`;
  };
  const blocks: string[] = [];
  blocks.push(`${lang === "pt" ? "PRÉ-JOGO" : "PRE-GAME"}${input.fresh.kind === "pre" ? (lang === "pt" ? " (NOVO)" : " (NEW)") : ""}`);
  blocks.push(input.pre.length ? input.pre.map(line).join("\n\n") : (lang === "pt" ? "(nenhum bilhete pré-jogo)" : "(no pre-game ticket)"));
  blocks.push("");
  blocks.push(lang === "pt" ? "AO VIVO" : "LIVE");
  if (!input.live.length) blocks.push(lang === "pt" ? "(nenhuma leitura ao vivo ainda)" : "(no live read yet)");
  for (const read of input.live) {
    const isFresh = input.fresh.kind === "live" && input.fresh.period === read.period;
    const head = `— ${quarterName(read.period, lang)}${read.minute !== undefined ? ` · ${lang === "pt" ? "minuto" : "minute"} ${read.minute}` : ""}${isFresh ? (lang === "pt" ? " (NOVO)" : " (NEW)") : ""}`;
    blocks.push(head);
    blocks.push(read.tickets.length ? read.tickets.map(line).join("\n\n") : "(—)");
    blocks.push("");
  }
  const text = `${input.matchup}\n\n${blocks.join("\n")}`.trimEnd() + "\n";
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const html = `<pre style="font: 14px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap">${esc(text)}</pre>`;
  return { subject, text, html };
}

const toMailTicket = (s: BetSuggestion): MailTicket => ({
  title: s.title, combinedDecimal: s.combinedDecimal, alternative: !!s.alternativeFor,
  legs: s.legs.map((l) => ({ selection: l.selection, oddsDecimal: l.oddsDecimal })),
});

/** Gathers the game's picture from what is stored: the pre-game slate and every live read in the ledger. */
export function gatherTicketMail(args: { gameId: string; sportKey: string; dateKey: string; matchup: string; lang: "pt" | "en"; fresh: TicketMailInput["fresh"] }): TicketMailInput {
  const preRow = findPrediction({ scope: "game", sportKey: args.sportKey, gameId: args.gameId, dateKey: args.dateKey, lang: args.lang });
  const pre = preRow ? (JSON.parse(preRow.payload) as BetSlate).suggestions.map(toMailTicket) : [];
  // The predictions table keeps only the latest live read per game; the ledger keeps them all.
  const byRead = new Map<string, MailLiveRead>();
  for (const e of readLiveLedger().filter((e) => e.gameId === args.gameId)) {
    const key = `${e.period ?? 0}:${e.minute ?? 0}`;
    const read = byRead.get(key) ?? { period: e.period, minute: e.minute, tickets: [] };
    read.tickets.push({ title: e.title, combinedDecimal: e.combinedDecimal, alternative: !!e.alternativeOf, legs: e.legs.map((l) => ({ selection: l.selection, oddsDecimal: l.oddsDecimal })) });
    byRead.set(key, read);
  }
  const live = [...byRead.values()].sort((a, b) => (a.period ?? 0) - (b.period ?? 0) || (a.minute ?? 0) - (b.minute ?? 0));
  return { matchup: args.matchup, sportKey: args.sportKey, fresh: args.fresh, pre, live, lang: args.lang };
}

let transport: Transporter | null = null;
function transportFor(cfg: TicketMailConfig): Transporter {
  if (!transport) transport = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass } });
  return transport;
}

/** Fire-and-forget: called after a read is saved; never throws into the generation path. */
export async function sendTicketMail(args: Parameters<typeof gatherTicketMail>[0]): Promise<{ sent: boolean; reason?: string }> {
  const cfg = ticketMailConfig();
  if (!cfg) return { sent: false, reason: "not configured" };
  try {
    const mail = renderTicketMail(gatherTicketMail(args));
    await transportFor(cfg).sendMail({ from: cfg.from, to: cfg.to.join(", "), subject: mail.subject, text: mail.text, html: mail.html });
    logEvent("mail.tickets", { gameId: args.gameId, fresh: args.fresh.kind, to: cfg.to.length });
    return { sent: true };
  } catch (error) {
    reportError("mail.tickets", error, { gameId: args.gameId }, "warn");
    return { sent: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
