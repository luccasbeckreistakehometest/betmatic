import type { Lang } from "@/lib/i18n";

/** Copy for the price comparison, written in pt-BR first; en kept in step. */
const COPY = {
  bestPrice: { pt: "melhor preço", en: "best price" },
  vsWorst: { pt: "vs pior", en: "vs worst" },
  onlyBook: { pt: "só cotado em", en: "only priced at" },
  noQuote: { pt: "sem cotação nas casas", en: "no book quote" },
  offConsensus: { pt: "fora do consenso", en: "off consensus" },
  betterLine: { pt: "linha melhor", en: "better line" },
  at: { pt: "na", en: "at" },
  fair: { pt: "justo", en: "fair" },
  exchange: { pt: "exchange", en: "exchange" },
  whereToBet: { pt: "Onde apostar", en: "Where to bet" },
  bestSingle: { pt: "bilhete inteiro na melhor casa", en: "whole ticket at the best book" },
  theoretical: { pt: "cada perna na sua melhor casa", en: "each leg at its best book" },
  notPlaceable: { pt: "não dá para montar num bilhete só", en: "cannot be placed as one ticket" },
  vsTicket: { pt: "vs preço do bilhete", en: "vs ticket price" },
  noSingleBook: { pt: "nenhuma casa cota todas as pernas", en: "no single book prices every leg" },
  booksRead: { pt: "casas lidas", en: "books read" },
  updated: { pt: "atualizado", en: "updated" },
  signals: { pt: "Linhas desbalanceadas", en: "Lines out of step" },
  signalsHint: { pt: "onde uma casa paga mais que as outras na mesma linha, ou dá uma linha mais fácil pelo mesmo preço", en: "where one book pays more than the rest at the same line, or posts an easier line for the same price" },
  over: { pt: "mais de", en: "over" },
  under: { pt: "menos de", en: "under" },
  others: { pt: "outras", en: "others" },
  median: { pt: "mediana das outras", en: "others' median" },
  feedOne: { pt: "feed", en: "feed" },
  feedMany: { pt: "feeds", en: "feeds" },
  bookOne: { pt: "casa", en: "book" },
  bookMany: { pt: "casas", en: "books" },
  justNow: { pt: "agora", en: "just now" },
  started: { pt: "jogo em andamento: os preços das casas eram os de antes do início", en: "game under way: the books' prices were the pre-game ones" },
} as const;

export type BooksCopyKey = keyof typeof COPY;
export const booksCopy = (lang: Lang) => (key: BooksCopyKey) => COPY[key][lang];

/** "mais de" / "over" for an over, "menos de" / "under" for an under — in either language. */
export const sideLabel = (side: "over" | "under", lang: Lang): string => COPY[side][lang];

/** "1 feed, 4 casas" / "2 feeds, 6 books": how many independent feeds and books sit behind a median. */
export function feedsLabel(feeds: number, books: number, lang: Lang): string {
  return `${feeds} ${COPY[feeds === 1 ? "feedOne" : "feedMany"][lang]}, ${books} ${COPY[books === 1 ? "bookOne" : "bookMany"][lang]}`;
}

/** "há 12 min" / "12 min ago"; hours past an hour; "agora" under a minute. */
export function relativeMinutes(iso: string | null | undefined, lang: Lang, now = Date.now()): string {
  if (!iso) return "";
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return COPY.justNow[lang];
  if (mins < 60) return lang === "pt" ? `há ${mins} min` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return lang === "pt" ? `há ${hours} h` : `${hours} h ago`;
}
