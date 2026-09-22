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
  median: { pt: "mediana", en: "median" },
} as const;

export type BooksCopyKey = keyof typeof COPY;
export const booksCopy = (lang: Lang) => (key: BooksCopyKey) => COPY[key][lang];
