import { createHash } from "node:crypto";
import type { BetSuggestion } from "@/lib/types";

/**
 * Plan B under every ticket. The model links an alternative to its main ticket by position in its own
 * list; positions change once tickets are priced, dropped and sorted, so ids are derived from the legs
 * and every link is re-pointed here.
 */
export const MAX_ALTERNATIVES = 2;

/** Stable across sorting and regeneration of the same ticket; unique per band and leg set. */
export function ticketId(bandKey: string, selections: string[]): string {
  return `${bandKey}-${createHash("sha1").update(selections.join("|")).digest("hex").slice(0, 8)}`;
}

export interface LinkInput {
  /** The model's `alternativeOf`: index of the main ticket in the raw list, or null for a main. */
  alternativeOf: number | null;
  swapReason: string | null;
  /** The priced ticket, or null when pricing dropped it. */
  priced: BetSuggestion | null;
}

/**
 * Resolves raw links onto priced tickets. An alternative whose main was dropped (or that points at
 * another alternative, itself, or nowhere) becomes a main ticket; a main keeps at most
 * MAX_ALTERNATIVES, in the model's order; a duplicate leg set is kept once.
 */
export function linkAlternatives(items: LinkInput[], max = MAX_ALTERNATIVES): BetSuggestion[] {
  const seen = new Set<string>();
  const altCount = new Map<string, number>();
  const out: BetSuggestion[] = [];
  items.forEach((item, i) => {
    const bet = item.priced;
    if (!bet || seen.has(bet.id)) return;
    const k = item.alternativeOf;
    const target = k !== null && k !== i && k >= 0 && k < items.length && items[k].alternativeOf === null ? items[k].priced : null;
    if (!target || target.id === bet.id) {
      seen.add(bet.id);
      out.push({ ...bet, alternativeFor: undefined, swapReason: undefined });
      return;
    }
    const n = altCount.get(target.id) ?? 0;
    if (n >= max) return;
    altCount.set(target.id, n + 1);
    seen.add(bet.id);
    out.push({ ...bet, alternativeFor: target.id, swapReason: item.swapReason?.trim() || undefined });
  });
  return out.sort((a, b) => a.combinedDecimal - b.combinedDecimal);
}

/** Main tickets with their alternatives attached, in display order. */
export function groupAlternatives<T extends Pick<BetSuggestion, "id" | "alternativeFor">>(bets: T[]): { main: T; alternatives: T[] }[] {
  const ids = new Set(bets.map((b) => b.id));
  const mains = bets.filter((b) => !b.alternativeFor || !ids.has(b.alternativeFor));
  return mains.map((main) => ({ main, alternatives: bets.filter((b) => b.alternativeFor === main.id) }));
}

/** What an alternative changes: legs dropped from the main, and legs it adds. */
export function legDiff(main: { legs: { selection: string }[] }, alt: { legs: { selection: string }[] }): { removed: string[]; added: string[]; kept: string[] } {
  const a = new Set(main.legs.map((l) => l.selection));
  const b = new Set(alt.legs.map((l) => l.selection));
  return {
    removed: [...a].filter((s) => !b.has(s)),
    added: [...b].filter((s) => !a.has(s)),
    kept: [...a].filter((s) => b.has(s)),
  };
}
