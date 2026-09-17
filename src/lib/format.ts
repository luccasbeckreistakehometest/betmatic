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
