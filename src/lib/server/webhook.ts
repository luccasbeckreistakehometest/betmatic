import { ticketSlug } from "@/lib/ledger/proof";
import { envValue } from "@/lib/env";
import { scrubSuggestion } from "@/lib/server/whitelabel";
import { formatDecimal } from "@/lib/odds";
import type { BetSuggestion } from "@/lib/types";

/**
 * Fire-and-forget announcement of new tickets to whatever the owner wires up: a Discord webhook,
 * a Telegram bot relay, a WhatsApp community bot. The payload is both a ready-to-post text and the
 * structured ticket, whitelabelled — the community never learns the sources either.
 */
export function ticketAnnouncement(args: { gameId: string; matchup: string; sportKey: string; lang: "pt" | "en"; suggestions: BetSuggestion[]; base: string }) {
  const top = [...args.suggestions].sort((a, b) => b.evidenceScore - a.evidenceScore).slice(0, 3).map((s) => scrubSuggestion(s, args.lang));
  const lines = top.map((s) => {
    const slug = ticketSlug(`${args.gameId}:${s.bandKey}:${s.legs.map((l) => l.selection).join("|")}`);
    return `• ${s.title} — ${formatDecimal(s.combinedDecimal)} (${args.lang === "pt" ? "confiança" : "confidence"} ${s.evidenceScore})\n  ${s.legs.map((l) => l.selection).join(" + ")}\n  ${args.base}/p/${slug}`;
  });
  const content = `${args.lang === "pt" ? "🎫 Bilhetes novos" : "🎫 New tickets"} — ${args.matchup}\n${lines.join("\n")}`;
  return { content, matchup: args.matchup, sportKey: args.sportKey, lang: args.lang, tickets: top.map((s) => ({ title: s.title, odds: s.combinedDecimal, evidenceScore: s.evidenceScore, legs: s.legs.map((l) => ({ selection: l.selection, odds: l.oddsDecimal })) })) };
}

export async function announceTickets(args: Parameters<typeof ticketAnnouncement>[0]): Promise<void> {
  const url = envValue("TICKET_WEBHOOK_URL");
  if (!/^https?:\/\//.test(url) || !args.suggestions.length) return;
  const body = ticketAnnouncement(args);
  try {
    // Discord accepts {content}; anything else gets the full structured payload alongside it.
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  } catch (error) {
    console.warn("[webhook] announce failed:", error instanceof Error ? error.message : error);
  }
}
