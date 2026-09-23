import type { Lang } from "@/lib/i18n";

/**
 * Dates and times as each audience reads them: the Portuguese app speaks Brasília time and pt-BR
 * formats; the English one keeps US formats with the zone named.
 */
export const APP_TIME_ZONE = { pt: "America/Sao_Paulo", en: "America/New_York" } as const;
const LOCALE = { pt: "pt-BR", en: "en-US" } as const;

export function formatTime(iso: string | Date, lang: Lang): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  const text = new Intl.DateTimeFormat(LOCALE[lang], { timeZone: APP_TIME_ZONE[lang], hour: "2-digit", minute: "2-digit" }).format(d);
  return lang === "pt" ? text : `${text} ET`;
}

export function formatDate(iso: string | Date, lang: Lang, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: APP_TIME_ZONE[lang],
    weekday: opts.weekday ? "short" : undefined,
    day: "numeric",
    month: "short",
    year: opts.year ? "numeric" : undefined,
  }).format(d);
}

export function formatDateTime(iso: string | Date, lang: Lang): string {
  return `${formatDate(iso, lang, { year: true })}, ${formatTime(iso, lang)}`;
}

/** A YYYYMMDD slate key (a calendar day, no time) in the reader's format. */
export function formatDayKey(dateKey: string, lang: Lang): string {
  const date = new Date(Date.UTC(+dateKey.slice(0, 4), +dateKey.slice(4, 6) - 1, +dateKey.slice(6, 8), 12));
  return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function formatMoneyBRL(value: number, lang: Lang, digits = 0): string {
  const amount = value.toLocaleString(LOCALE[lang], { minimumFractionDigits: digits, maximumFractionDigits: digits });
  // English readers get the currency spelled out: the charge is in Brazilian reais.
  return lang === "pt" ? `R$ ${amount}` : `R$ ${amount} (BRL)`;
}

const STATUS_PT: [RegExp, string][] = [
  [/^(final|ft|full time)$/i, "Encerrado"],
  [/^final\/ot$/i, "Encerrado (prorrogação)"],
  [/^(ht|halftime|half time)$/i, "Intervalo"],
  [/^postponed$/i, "Adiado"],
  [/^(canceled|cancelled)$/i, "Cancelado"],
  [/^suspended$/i, "Suspenso"],
  [/^live$/i, "Ao vivo"],
  [/^aet$/i, "Encerrado (prorrogação)"],
  [/^(ft-pens|pens)$/i, "Encerrado (pênaltis)"],
];

/** ESPN's status line is English; the Portuguese app shows the common ones in Portuguese. */
export function localizeStatus(detail: string, lang: Lang): string {
  if (lang === "en") return detail;
  const hit = STATUS_PT.find(([re]) => re.test(detail.trim()));
  if (hit) return hit[1];
  return detail
    .replace(/\b(\d+)(st|nd|rd|th) Half\b/i, "$1º tempo")
    .replace(/\b(\d+)(st|nd|rd|th) Quarter\b/i, "$1º quarto")
    .replace(/\bEnd of\b/i, "Fim do")
    .replace(/\bOT\b/, "prorrogação");
}

const STAT_PT: Record<string, string> = {
  "points": "Pontos", "pts": "Pontos", "rebounds": "Rebotes", "reb": "Rebotes", "assists": "Assistências", "ast": "Assistências",
  "steals": "Roubos de bola", "blocks": "Tocos", "turnovers": "Erros", "fouls": "Faltas", "field goal %": "Arremessos (%)",
  "fg": "Arremessos", "fg%": "Arremessos (%)", "3pt": "Bolas de 3", "3p%": "Bolas de 3 (%)", "three point %": "Bolas de 3 (%)",
  "ft": "Lances livres", "ft%": "Lances livres (%)", "free throw %": "Lances livres (%)", "offensive rebounds": "Rebotes ofensivos",
  "defensive rebounds": "Rebotes defensivos", "technical fouls": "Faltas técnicas", "flagrant fouls": "Faltas flagrantes",
  "largest lead": "Maior vantagem", "points per game": "Pontos por jogo", "rebounds per game": "Rebotes por jogo",
  "assists per game": "Assistências por jogo", "points allowed": "Pontos sofridos", "fast break points": "Pontos de contra-ataque",
  "points in paint": "Pontos no garrafão", "possession": "Posse de bola", "shots": "Finalizações", "shots on goal": "Finalizações no alvo",
  "shots on target": "Finalizações no alvo", "on goal": "No alvo", "corner kicks": "Escanteios", "corners": "Escanteios",
  "yellow cards": "Cartões amarelos", "red cards": "Cartões vermelhos", "offsides": "Impedimentos", "saves": "Defesas",
  "goals": "Gols", "fouls committed": "Faltas cometidas", "passes": "Passes", "accurate passes": "Passes certos",
  "pass completion %": "Passes certos (%)", "tackles": "Desarmes", "crosses": "Cruzamentos", "clearances": "Cortes",
  "interceptions": "Interceptações", "blocked shots": "Chutes bloqueados", "goals against": "Gols sofridos",
};

/** ESPN stat labels are English; the Portuguese app translates the ones it knows and keeps the rest. */
export function localizeStatLabel(label: string, lang: Lang): string {
  if (lang === "en") return label;
  return STAT_PT[label.trim().toLowerCase()] ?? label;
}

/* ------------------------------------------------------------------------------------------------
 * Numbers (docs/DESIGN.md §11.2)
 *
 * One formatter set for the whole product. A component never calls toFixed: 159 of those calls are
 * why `R$ 0,00` ships next to `0.0%` on the same pt-BR page today. Rules encoded here:
 *   · pt-BR is absolute — comma decimal, dot thousands, a non-breaking space before the unit;
 *   · the minus sign is U+2212, never a hyphen, so a negative lines up with a positive in a column;
 *   · deltas always print their sign, and zero prints without one;
 *   · "not priced" is an em dash, never `0` and never `- / -`;
 *   · odds always carry two decimals so the decimal points align down a column.
 * Every string below is meant to be set in Plex Mono with tabular figures (`nums`).
 * ---------------------------------------------------------------------------------------------- */

/** What a cell shows when there is no number — never `0`, never `- / -`. */
export const NOT_PRICED = "—";
const MINUS = "−";
const NBSP = " ";

function fixSigns(text: string): string {
  return text.replace(/-/g, MINUS);
}

/** Decides the sign a delta shows: explicit + above zero, U+2212 below it, nothing at zero. */
function signOf(value: number, signed: boolean): string {
  if (!signed || value === 0) return "";
  return value > 0 ? "+" : "";
}

export function formatNumber(value: number, lang: Lang, opts: { digits?: number; signed?: boolean } = {}): string {
  if (!Number.isFinite(value)) return NOT_PRICED;
  const digits = opts.digits ?? 0;
  const text = new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  return `${signOf(value, opts.signed ?? false)}${fixSigns(text)}`;
}

/** R$ 1.234,56 — one currency per view; the admin's USD costs are labelled in their own group. */
export function formatMoney(value: number, lang: Lang, opts: { digits?: number; signed?: boolean } = {}): string {
  if (!Number.isFinite(value)) return NOT_PRICED;
  const digits = opts.digits ?? 2;
  const amount = new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value));
  const sign = value < 0 ? MINUS : signOf(value, opts.signed ?? false);
  return `${sign}R$${NBSP}${amount}`;
}

/**
 * The model's bill is in dollars and says so. One helper per currency, so the admin never prints
 * `$0.00` beside `US$ 0,00` for the same quantity (docs/DESIGN.md §11.2).
 */
export function formatUsd(value: number, lang: Lang, opts: { digits?: number } = {}): string {
  if (!Number.isFinite(value)) return NOT_PRICED;
  const digits = opts.digits ?? 2;
  const amount = new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value));
  return `${value < 0 ? MINUS : ""}US$${NBSP}${amount}`;
}

/**
 * A chance, from a fraction: 0.417 → "41,7 %". The space before the unit is the Brazilian standard
 * and is non-breaking, so a number never wraps away from its unit at the end of a line.
 */
export function formatPercent(fraction: number, lang: Lang, opts: { digits?: number; signed?: boolean } = {}): string {
  if (!Number.isFinite(fraction)) return NOT_PRICED;
  const digits = opts.digits ?? 1;
  const text = new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(fraction * 100);
  return `${signOf(fraction, opts.signed ?? false)}${fixSigns(text)}${NBSP}%`;
}

/** Units of bankroll: "+2,40 u" / "−1,74 u". Always signed — a unit result is a delta. */
export function formatUnits(value: number, lang: Lang, digits = 2): string {
  if (!Number.isFinite(value)) return NOT_PRICED;
  return `${formatNumber(value, lang, { digits, signed: true })}${NBSP}u`;
}

/**
 * A stake in units: "1,25 u". Unsigned on purpose — `formatUnits` signs because a *result* is a
 * delta, but a stake is a quantity, and "+1,25 u" beside "Apostar" reads as a profit.
 */
export function formatStakeUnits(value: number, lang: Lang, digits = 2): string {
  if (!Number.isFinite(value)) return NOT_PRICED;
  return `${formatNumber(value, lang, { digits })}${NBSP}u`;
}

/** A decimal multiplier, always two decimals so the points align down a column. */
export function formatOdds(decimal: number, lang: Lang): string {
  if (!Number.isFinite(decimal) || decimal <= 0) return NOT_PRICED;
  return formatNumber(decimal, lang, { digits: 2 });
}

/** The chance a price implies, before any margin is removed. Feeds the <Odds> primitive. */
export function impliedFromDecimal(decimal: number): number {
  if (!Number.isFinite(decimal) || decimal <= 0) return NaN;
  return 1 / decimal;
}

/** American odds for the English side of the product: +145 / −180, with a real minus. */
export function formatAmerican(decimal: number, lang: Lang): string {
  if (!Number.isFinite(decimal) || decimal <= 1) return NOT_PRICED;
  const american = decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
  return formatNumber(american, lang, { signed: true });
}
