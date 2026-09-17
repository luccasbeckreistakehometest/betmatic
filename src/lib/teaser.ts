import { getBand } from "@/lib/odds";
import { getPlan } from "@/lib/plans";
import type { Lang } from "@/lib/i18n";
import type { BetSuggestion } from "@/lib/types";

/**
 * What a visitor may learn about a ticket before kickoff: its shape, never its pick. Titles and
 * backgrounds are written around the selections ("Agoumé comete falta"), so a teaser shows the
 * number of legs, the band and the price instead.
 */
export const legsLabel = (n: number, lang: Lang) =>
  lang === "pt" ? `${n} ${n === 1 ? "perna" : "pernas"}` : `${n} ${n === 1 ? "leg" : "legs"}`;

export function teaserHeadline(bet: Pick<BetSuggestion, "legs" | "bandKey">, lang: Lang): string {
  const band = getBand(bet.bandKey).label[lang].replace(/\s*\(.*\)$/, "");
  const n = bet.legs.length;
  if (lang === "pt") return n > 1 ? `Múltipla de ${n} pernas · faixa ${band}` : `Aposta simples · faixa ${band}`;
  return n > 1 ? `${n}-leg parlay · ${band} band` : `Single · ${band} band`;
}

/** True when a new free account can open this ticket (its band is in the free plan). */
export const freeCanSee = (bet: Pick<BetSuggestion, "bandKey">) => getPlan("free").bands.includes(bet.bandKey);

/**
 * The teaser a funnel should show: the best-evidenced ticket a free account can open, else the best
 * one overall (flagged, so the call to action says "plans" instead of promising a free look).
 */
export function pickTeaser<T extends { bet: BetSuggestion }>(candidates: T[]): (T & { free: boolean }) | null {
  const best = (list: T[]) => list.reduce<T | null>((top, c) => (!top || c.bet.evidenceScore > top.bet.evidenceScore ? c : top), null);
  const free = best(candidates.filter((c) => freeCanSee(c.bet)));
  if (free) return { ...free, free: true };
  const any = best(candidates);
  return any ? { ...any, free: false } : null;
}
