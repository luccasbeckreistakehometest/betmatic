import { z } from "zod";
import { generateStructured } from "@/lib/ai/extract";
import { CHEAP_MODEL } from "@/lib/ai/client";
import { formatAmerican, formatDecimal, impliedProbability } from "@/lib/odds";
import type { SolvedTicket } from "@/lib/bets/custom-parlay";
import type { Lang } from "@/lib/i18n";
import type { Settlement } from "@/lib/types";

/**
 * The words around a solved custom parlay. Every number comes from the solver; the model (the cheap
 * one) only writes the title, the context and one line per leg.
 */
export interface CustomLegView {
  key: string; gameId: string; matchup: string; selection: string; market: string; decimal: number;
  fairProbability: number; measured: boolean; evidence: string; note: string; settlement: Settlement; athleteId?: string;
  /** Kickoff of the leg's game, attached by the route (the lineup watcher and the close job read it). */
  startsAt?: string;
}
export interface CustomTicketView {
  title: string; background: string; riskNote: string;
  decimal: number; american: string; fairProbability: number; impliedProbability: number; ev: number;
  legs: CustomLegView[];
}

const WriteupSchema = z.object({
  tickets: z.array(z.object({
    title: z.string().describe("Short label, max 6 words."),
    background: z.string().describe("Two sentences on why these legs fit together. No promises."),
    riskNote: z.string().describe("The most likely way this ticket breaks."),
    legNotes: z.array(z.string().describe("One short line on this leg, grounded in its evidence.")),
  })),
});

const SYSTEM = {
  en: `You write short notes for betting tickets that a program already built. Never change or add a number, never promise a result, never suggest a stake. Ground every line in the evidence given. A long price means a low chance — say so plainly. Write in American English.`,
  pt: `Você escreve notas curtas para bilhetes que um programa já montou. Nunca mude ou invente números, nunca prometa resultado, nunca sugira valor de aposta. Cada linha se apoia na evidência dada. Odd alta é chance baixa — diga isso sem rodeio. Escreva em português do Brasil, com o vocabulário do apostador (bilhete, perna, múltipla).`,
};

function view(t: SolvedTicket, words: { title: string; background: string; riskNote: string; legNotes: string[] }): CustomTicketView {
  return {
    ...words,
    decimal: t.decimal, american: formatAmerican(t.decimal), fairProbability: t.fairProbability, impliedProbability: impliedProbability(t.decimal), ev: t.ev,
    legs: t.legs.map((l, i) => ({
      key: l.key, gameId: l.gameId, matchup: l.matchup, selection: l.selection, market: l.market, decimal: l.decimal,
      fairProbability: l.fairProbability, measured: l.measured, evidence: l.evidence, note: words.legNotes[i] ?? "", settlement: l.settlement, athleteId: l.athleteId,
    })),
  };
}

export function templateCustomTickets(tickets: SolvedTicket[], lang: Lang): CustomTicketView[] {
  return tickets.map((t, n) => view(t, {
    title: lang === "pt" ? `Opção ${n + 1}: ${t.legs.length} pernas` : `Option ${n + 1}: ${t.legs.length} legs`,
    background: lang === "pt"
      ? `Montada pelas pernas com melhor chance medida que chegam em ${formatDecimal(t.decimal)}, uma por jogo.`
      : `Built from the best-measured legs that reach ${formatDecimal(t.decimal)}, one per game.`,
    riskNote: lang === "pt"
      ? `Chance estimada de ${(t.fairProbability * 100).toFixed(1)}%: na maioria das vezes, uma perna cai.`
      : `Estimated chance ${(t.fairProbability * 100).toFixed(1)}%: most of the time, one leg breaks.`,
    legNotes: t.legs.map((l) => l.evidence),
  }));
}

export async function explainCustomTickets(tickets: SolvedTicket[], lang: Lang): Promise<CustomTicketView[]> {
  const prompt = tickets.map((t, n) => [
    `TICKET ${n + 1}: ${formatDecimal(t.decimal)}, estimated chance ${(t.fairProbability * 100).toFixed(1)}%`,
    ...t.legs.map((l, i) => `  [${i}] ${l.matchup} — ${l.selection} @ ${l.decimal.toFixed(2)} | evidence: ${l.evidence}`),
  ].join("\n")).join("\n\n");
  const out = await generateStructured({
    schema: WriteupSchema,
    system: SYSTEM[lang],
    prompt: `${prompt}\n\nWrite one entry per ticket, in order, with exactly one legNote per leg.`,
    model: CHEAP_MODEL,
    maxTokens: 2000,
    label: "custom_parlay",
    mock: () => ({ tickets: templateCustomTickets(tickets, lang).map((t) => ({ title: t.title, background: t.background, riskNote: t.riskNote, legNotes: t.legs.map((l) => l.evidence) })) }),
  });
  if (out.tickets.length !== tickets.length) throw new Error("write-up count mismatch");
  return tickets.map((t, i) => view(t, out.tickets[i]));
}
