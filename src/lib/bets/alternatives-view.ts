/**
 * Client-safe helpers for showing alternatives (the linking itself lives in alternatives.ts, which
 * uses node:crypto).
 */
export function groupAlternatives<T extends { id: string; alternativeFor?: string }>(bets: T[]): { main: T; alternatives: T[] }[] {
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
