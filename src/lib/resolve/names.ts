/**
 * Matching what a bettor typed (or what a slip print says) to ESPN's games, teams and players.
 * Pure and shared by the deep slip analysis, the slip scanner and the tipster audit.
 */
export function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+.,\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** How Brazilian books and bettors write clubs whose ESPN name differs. Keys are ESPN-side names. */
const TEAM_ALIASES: Record<string, string[]> = {
  "atletico-mg": ["atletico mineiro", "atletico-mg", "galo", "cam"],
  "athletico-pr": ["athletico paranaense", "athletico-pr", "athletico", "furacao", "cap"],
  "sao paulo": ["sao paulo", "spfc", "tricolor paulista"],
  "vasco da gama": ["vasco", "vasco da gama"],
  internacional: ["inter", "internacional", "colorado"],
  "red bull bragantino": ["bragantino", "rb bragantino", "red bull bragantino"],
  "vitoria": ["vitoria", "ec vitoria"],
  "gremio": ["gremio", "tricolor gaucho"],
  "palmeiras": ["palmeiras", "verdao"],
  "flamengo": ["flamengo", "mengao", "fla"],
  "corinthians": ["corinthians", "timao"],
  "fluminense": ["fluminense", "flu"],
  "botafogo": ["botafogo", "fogao"],
  "cruzeiro": ["cruzeiro", "raposa"],
  "santos": ["santos", "peixe"],
  "fortaleza": ["fortaleza", "leao do pici"],
  "bahia": ["bahia", "esquadrao"],
  "manchester united": ["man united", "man utd", "manchester united"],
  "manchester city": ["man city", "manchester city"],
  "tottenham hotspur": ["tottenham", "spurs"],
  "wolverhampton wanderers": ["wolves", "wolverhampton"],
  "brighton & hove albion": ["brighton"],
  "paris saint-germain": ["psg", "paris saint-germain", "paris sg"],
  "bayern munich": ["bayern", "bayern de munique", "bayern munchen"],
  "atletico madrid": ["atletico de madrid", "atletico madrid", "atleti"],
  "real madrid": ["real madrid", "real"],
  "inter milan": ["inter de milao", "internazionale", "inter milan"],
  "ac milan": ["milan", "ac milan"],
  "juventus": ["juventus", "juve"],
};

export interface TeamLike { abbreviation: string; name?: string; displayName: string; shortDisplayName?: string }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word containment, so "inter" does not match "internacional" by accident and vice versa. */
export const containsWord = (haystack: string, needle: string): boolean =>
  needle.length > 1 && new RegExp(`(^|[^a-z0-9])${escape(needle)}($|[^a-z0-9])`).test(haystack);

/** The names a team goes by, normalised. Abbreviations only count when written in capitals in the source. */
export function teamNames(team: TeamLike): string[] {
  const display = normaliseName(team.displayName);
  const names = new Set([display, normaliseName(team.name ?? ""), normaliseName(team.shortDisplayName ?? "")].filter((n) => n.length > 2));
  for (const [key, aliases] of Object.entries(TEAM_ALIASES)) {
    if (display === key || display.startsWith(`${key} `) || names.has(key)) aliases.forEach((a) => names.add(a));
  }
  return [...names];
}

/** The longest team name found in the text (0 when none), so "Atlético Mineiro" beats "Mineiro". */
export function teamMention(raw: string, team: TeamLike): number {
  const text = normaliseName(raw);
  let best = 0;
  for (const n of teamNames(team)) if (containsWord(text, n)) best = Math.max(best, n.length);
  if (!best && team.abbreviation.length >= 2 && new RegExp(`(^|[^A-Z])${escape(team.abbreviation.toUpperCase())}($|[^A-Z])`).test(raw)) best = 2;
  return best;
}

/** A player named in the text: the full name first, then a unique surname. */
export function playerMention<T extends { name: string }>(raw: string, athletes: T[]): T | null {
  const text = normaliseName(raw);
  const full = athletes.filter((a) => containsWord(text, normaliseName(a.name)));
  if (full.length) return full.sort((a, b) => b.name.length - a.name.length)[0];
  const bySurname = athletes.filter((a) => {
    const parts = normaliseName(a.name).split(" ");
    const last = parts[parts.length - 1];
    return last.length >= 4 && containsWord(text, last);
  });
  return bySurname.length === 1 ? bySurname[0] : null;
}

/** "mais de 17,5", "over 17.5", "O 17.5", "18+", "menos de 2,5": the side and the line. */
export function parseLine(raw: string): { side: "over" | "under"; line: number } | null {
  const text = normaliseName(raw).replace(/(\d),(\d)/g, "$1.$2");
  const over = text.match(/(?:mais de|acima de|over|\bo)\s*(\d+(?:\.\d+)?)/);
  if (over) return { side: "over", line: Number(over[1]) };
  const under = text.match(/(?:menos de|abaixo de|under|\bu)\s*(\d+(?:\.\d+)?)/);
  if (under) return { side: "under", line: Number(under[1]) };
  const milestone = text.match(/(\d+)\s*\+/);
  if (milestone) return { side: "over", line: Number(milestone[1]) - 0.5 };
  return null;
}

const WIN_WORDS = /\b(vence|vencer|vitoria|ganha|win|wins|moneyline|ml|para vencer|resultado final)\b/;
export const mentionsWin = (raw: string) => WIN_WORDS.test(normaliseName(raw));
export const mentionsDraw = (raw: string) => /\b(empate|draw)\b/.test(normaliseName(raw));
