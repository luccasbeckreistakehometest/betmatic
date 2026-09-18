import { formatNumber, NOT_PRICED } from "@/lib/format";
import type { Lang } from "@/lib/i18n";

/**
 * Odds maths. Everything internally is decimal odds — parlays multiply cleanly in decimal and the
 * implied probability is just the reciprocal.
 */

export function americanToDecimal(american: number): number {
  if (!Number.isFinite(american) || american === 0) return NaN;
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

export function decimalToAmerican(decimal: number): number {
  if (!Number.isFinite(decimal) || decimal <= 1) return NaN;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : -Math.round(100 / (decimal - 1));
}

/** Accepts "+150", "-230", "2.50", "5/2" — the formats these sites mix freely. */
export function parseOdds(raw: string | number | undefined | null): number {
  if (raw === undefined || raw === null) return NaN;
  if (typeof raw === "number") return raw > 0 && raw < 100 ? raw : americanToDecimal(raw);
  const text = String(raw).trim().replace(/\s/g, "");
  if (!text) return NaN;

  const fraction = text.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (fraction) return 1 + Number(fraction[1]) / Number(fraction[2]);

  if (/^[+-]\d+$/.test(text)) return americanToDecimal(Number(text));

  const value = Number(text);
  if (!Number.isFinite(value)) return NaN;
  // A bare number above 100 is American (e.g. "150"); at or below 100 it is decimal.
  return value > 100 || value < -100 ? americanToDecimal(value) : value;
}

export function formatAmerican(decimal: number): string {
  const american = decimalToAmerican(decimal);
  if (!Number.isFinite(american)) return "—";
  return american > 0 ? `+${american}` : String(american);
}

export function parlayDecimal(legs: number[]): number {
  if (!legs.length || legs.some((d) => !Number.isFinite(d) || d <= 1)) return NaN;
  return legs.reduce((acc, d) => acc * d, 1);
}

export function impliedProbability(decimal: number): number {
  return Number.isFinite(decimal) && decimal > 0 ? 1 / decimal : NaN;
}

/**
 * The bookmaker's margin compounds with every leg — this is the number that makes a 400x parlay
 * look like what it actually is. `fairLegs` are the modelled true probabilities of each leg.
 */
export function parlayHold(legOdds: number[], fairLegs: number[]): number {
  const impliedProb = impliedProbability(parlayDecimal(legOdds));
  const fairProb = fairLegs.reduce((acc, p) => acc * p, 1);
  if (!Number.isFinite(impliedProb) || !Number.isFinite(fairProb) || impliedProb <= 0) return NaN;
  // Equivalent to -EV per unit staked: 1 - fairProb * combinedDecimal.
  return 1 - fairProb / impliedProb;
}

/**
 * Expected value per unit staked. Negative means the price is worse than the modelled chance.
 *
 * Both arrays must describe the SAME legs. Passing every leg's probability alongside only the
 * priced legs' odds silently values a two-leg parlay at one-leg odds, which reads as a large
 * negative edge when the truth is that the edge is unknown — so a length mismatch returns NaN.
 */
export function expectedValue(legOdds: number[], fairLegs: number[]): number {
  if (legOdds.length !== fairLegs.length) return NaN;
  const combined = parlayDecimal(legOdds);
  const fairProb = fairLegs.reduce((acc, p) => acc * p, 1);
  if (!Number.isFinite(combined) || !Number.isFinite(fairProb)) return NaN;
  return fairProb * combined - 1;
}

export interface OddsBand {
  key: string;
  label: { en: string; pt: string };
  min: number;
  max: number;
  /** Rough leg count that lands in this band at typical prices. */
  typicalLegs: string;
}

/** The ladder the bet builder targets, from near-even singles to lottery-ticket parlays. */
export const ODDS_BANDS: OddsBand[] = [
  { key: "safe", label: { en: "Short (1.3x–2x)", pt: "Baixa (1,3x–2x)" }, min: 1.3, max: 2, typicalLegs: "1 leg" },
  { key: "value", label: { en: "Value (2x–5x)", pt: "Valor (2x–5x)" }, min: 2, max: 5, typicalLegs: "1–2 legs" },
  { key: "mid", label: { en: "Mid (5x–20x)", pt: "Média (5x–20x)" }, min: 5, max: 20, typicalLegs: "2–4 legs" },
  { key: "long", label: { en: "Long (20x–100x)", pt: "Longa (20x–100x)" }, min: 20, max: 100, typicalLegs: "4–6 legs" },
  { key: "moonshot", label: { en: "Moonshot (100x–500x)", pt: "Moonshot (100x–500x)" }, min: 100, max: 500, typicalLegs: "6–9 legs" },
  { key: "lottery", label: { en: "Lottery (500x+)", pt: "Loteria (500x+)" }, min: 500, max: 100_000, typicalLegs: "9+ legs" },
];

export function getBand(key: string | undefined): OddsBand {
  return ODDS_BANDS.find((b) => b.key === key) ?? ODDS_BANDS[2];
}

export function bandFor(decimal: number): OddsBand | null {
  return ODDS_BANDS.find((b) => decimal >= b.min && decimal < b.max) ?? null;
}

/**
 * A multiplier with its `x`. The reader's locale decides the decimal mark, so a pt-BR page never
 * prints `21.00x` above `50,0 %` (docs/DESIGN.md §11.2). Plain-text outputs that are not a page —
 * webhook lines, share text, the model's own write-up — keep the en form by omitting `lang`.
 */
export function formatDecimal(decimal: number, lang: Lang = "en"): string {
  if (!Number.isFinite(decimal)) return NOT_PRICED;
  return `${formatNumber(decimal, lang, { digits: decimal >= 100 ? 0 : 2 })}x`;
}

/**
 * Fractional Kelly stake as a share of bankroll. Full Kelly maximises log growth but assumes the
 * probability is exactly right; a quarter is what most disciplined bettors actually use, because a
 * model's edge is never as sharp as it looks. Returns 0 when there is no edge.
 */
export function kellyFraction(decimal: number, fairProb: number, fraction = 0.25): number {
  if (!Number.isFinite(decimal) || decimal <= 1 || !(fairProb > 0 && fairProb < 1)) return 0;
  const b = decimal - 1;
  const full = (b * fairProb - (1 - fairProb)) / b;
  return full > 0 ? Number((full * fraction).toFixed(4)) : 0;
}

/**
 * The two sides of one market with the book's margin removed (proportional method): the fair
 * chance of each side. -110/-110 is 50/50.
 */
export function noVigPair(a: number, b: number): { a: number; b: number } {
  const pa = impliedProbability(a);
  const pb = impliedProbability(b);
  if (!Number.isFinite(pa) || !Number.isFinite(pb) || pa + pb <= 0) return { a: NaN, b: NaN };
  return { a: pa / (pa + pb), b: pb / (pa + pb) };
}
