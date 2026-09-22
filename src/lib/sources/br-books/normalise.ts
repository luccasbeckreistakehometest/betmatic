import type { BookSide, BookSport } from "@/lib/sources/br-books/types";
import { getSport } from "@/lib/sports";

/**
 * Each book prints its markets in its own Portuguese. This file maps those labels onto the repo's
 * own vocabulary — the MarketDef keys in lib/sports.ts that the settlement and the measured
 * history already speak (points, rebounds, pra, shots_on_target…) — and normalises the two other
 * things books disagree on: how a player is written ("Amoore, Georgia" / "Georgia Amoore (WAS)")
 * and how a team is written ("Connecticut Sun (F)" / "LA Sparks").
 */

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** "Amoore, Georgia" → "Georgia Amoore"; "Shakira Austin (WAS)" → "Shakira Austin". */
export function normalisePlayer(raw: string): string {
  let name = raw.replace(/\s*\([A-Z]{2,4}\)\s*$/, "").replace(/\s+/g, " ").trim();
  const comma = name.match(/^([^,]+),\s*(.+)$/);
  if (comma) name = `${comma[2].trim()} ${comma[1].trim()}`;
  return name;
}

/** Lower-case, accent-free, letters only: the join key for a player across books and ESPN. */
export function playerKey(raw: string): string {
  return stripAccents(normalisePlayer(raw)).toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

/** Drops the women's-league marker books append ("(F)", "(W)", "Femininos") and collapses spaces. */
export function normaliseTeam(raw: string): string {
  return raw
    .replace(/\s*\((?:F|W|Fem\.?|Feminino|Women)\)\s*/gi, " ")
    .replace(/,\s*Femininos?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function teamKey(raw: string): string {
  return stripAccents(normaliseTeam(raw)).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function sportOf(sportKey: string): BookSport | null {
  const group = getSport(sportKey).group;
  return group === "basketball" ? "basketball" : group === "soccer" ? "soccer" : null;
}

/**
 * Basketball stat labels as the books print them, in Portuguese and English, longest combo first
 * so "Pontos + Rebotes + Assistências" never resolves to plain points.
 */
const BASKETBALL_STATS: { key: string; re: RegExp }[] = [
  { key: "pra", re: /pontos?\s*\+?\s*(?:e\s*)?rebotes?\s*\+?\s*(?:e\s*)?assist|pts[\s-]*reb[\s-]*ast|points.*rebounds.*assists|\bpra\b/i },
  { key: "ra", re: /rebotes?\s*\+?\s*(?:e\s*)?assist|reb[\s-]*ast|rebounds.*assists/i },
  { key: "pa", re: /pontos?\s*\+?\s*(?:e\s*)?assist|pts[\s-]*ast|points.*assists/i },
  { key: "pr", re: /pontos?\s*\+?\s*(?:e\s*)?rebotes|pts[\s-]*reb|points.*rebounds/i },
  { key: "threes", re: /cestas? de 3|3\s*pontos|3\s*pts|3pt|tr[êe]s pontos|three|3-point/i },
  { key: "steals", re: /roubos?|steals?/i },
  { key: "blocks", re: /tocos?|bloqueios?|blocks?/i },
  { key: "turnovers", re: /erros|perdas? de (?:posse|bola)|turnovers?/i },
  { key: "assists", re: /assist/i },
  { key: "rebounds", re: /rebotes?|rebounds?/i },
  { key: "points", re: /pontos?|points?/i },
];

const SOCCER_STATS: { key: string; re: RegExp }[] = [
  { key: "shots_on_target", re: /(?:finaliza|chutes?|remates?).*(?:no alvo|no gol|a gol)|shots? on target/i },
  { key: "shots", re: /finaliza|chutes?|remates?|shots?/i },
  { key: "goal_involvement", re: /gols?\s*(?:\+|e|ou)\s*assist/i },
  { key: "assists", re: /assist/i },
  { key: "goals", re: /marcar|gols?|goals?|goalscorer|artilheiro/i },
  { key: "fouls_committed", re: /faltas? cometid|fouls? committed/i },
  { key: "fouls_suffered", re: /faltas? sofrid|fouls? (?:won|suffered)/i },
  { key: "offsides", re: /impediment|offside/i },
  { key: "cards", re: /cart[ãa]o|card/i },
];

/** The MarketDef key for a player-market label, or null when the stat is not one the repo settles. */
export function statFromLabel(label: string, sport: BookSport): string | null {
  const text = stripAccents(label);
  for (const s of sport === "basketball" ? BASKETBALL_STATS : SOCCER_STATS) if (s.re.test(text)) return s.key;
  return null;
}

/** "Mais de 7.5" / "Menos de 7.5" / "Over" / "Under" / "Mais" / "Menos" → side. */
export function sideFromLabel(label: string): "over" | "under" | null {
  const t = stripAccents(label).toLowerCase();
  if (/\b(mais|over|acima)\b/.test(t)) return "over";
  if (/\b(menos|under|abaixo)\b/.test(t)) return "under";
  return null;
}

/** "18+" → 18; "Terá 10 ou mais" → 10. A milestone rung N is priced as over N − 0.5. */
export function milestoneRung(text: string): number | null {
  const m = stripAccents(text).match(/(\d+(?:[.,]\d+)?)\s*\+|(\d+(?:[.,]\d+)?)\s+ou mais/i);
  const n = m ? Number((m[1] ?? m[2]).replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export const milestoneLine = (rung: number): number => rung - 0.5;

/** A number a book prints as "17.5", "17,5", "+7.5", "-21.5". */
export function parseLineValue(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^([+-]?\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** A price above 1.0 with at most four decimals, or null. Books occasionally post 1.0 for a settled rung. */
export function cleanDecimal(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(",", ".")) : NaN;
  if (!Number.isFinite(n) || n <= 1 || n > 1000) return null;
  return Number(n.toFixed(4));
}

/** The MarketDef the repo uses for a book stat, so a row carries the same `market` text as the feed's prop rows. */
export function marketLabelFor(sportKey: string, stat: string): string | null {
  return getSport(sportKey).markets.find((m) => m.key === stat)?.label.en ?? null;
}

export const isTwoWaySide = (side: BookSide | undefined): side is "over" | "under" | "home" | "away" =>
  side === "over" || side === "under" || side === "home" || side === "away";
