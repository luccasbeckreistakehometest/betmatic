import { formatNumber } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import type { BookCandidate } from "@/lib/sources/br-books/coverage";

/** Copy for the price comparison, written in pt-BR first; en kept in step. */
const COPY = {
  bestPrice: { pt: "melhor preço", en: "best price" },
  vsWorst: { pt: "vs pior", en: "vs worst" },
  onlyBook: { pt: "só cotado em", en: "only priced at" },
  noQuote: { pt: "sem cotação nas casas", en: "no book quote" },
  offConsensus: { pt: "fora do consenso", en: "off consensus" },
  betterLine: { pt: "número melhor", en: "better line" },
  at: { pt: "na", en: "at" },
  fair: { pt: "justo", en: "fair" },
  exchange: { pt: "exchange", en: "exchange" },
  whereToBet: { pt: "Onde apostar", en: "Where to bet" },
  bestSingle: { pt: "bilhete inteiro na melhor casa", en: "whole ticket at the best book" },
  theoretical: { pt: "cada linha na sua melhor casa", en: "each leg at its best book" },
  notPlaceable: { pt: "não dá para montar num bilhete só", en: "cannot be placed as one ticket" },
  vsTicket: { pt: "vs preço do bilhete", en: "vs ticket price" },
  noSingleBook: { pt: "nenhuma casa cota todas as linhas do bilhete", en: "no single book prices every leg" },
  booksRead: { pt: "casas lidas", en: "books read" },
  updated: { pt: "atualizado", en: "updated" },
  // Rendered inches from "cada linha na sua melhor casa": the market sense becomes "número".
  signals: { pt: "Números desbalanceados", en: "Lines out of step" },
  signalsHint: { pt: "onde uma casa paga mais que as outras no mesmo número, ou dá um número mais fácil pelo mesmo preço", en: "where one book pays more than the rest at the same line, or posts an easier line for the same price" },
  over: { pt: "mais de", en: "over" },
  under: { pt: "menos de", en: "under" },
  others: { pt: "outras", en: "others" },
  median: { pt: "mediana das outras", en: "others' median" },
  feedOne: { pt: "feed", en: "feed" },
  feedMany: { pt: "feeds", en: "feeds" },
  bookOne: { pt: "casa", en: "book" },
  bookMany: { pt: "casas", en: "books" },
  justNow: { pt: "agora", en: "just now" },
  // "Abrir na casa com o bilhete montado": the outbound links under a leg and under a ticket.
  openAt: { pt: "Abrir na", en: "Open at" },
  openTicketAt: { pt: "Abrir o bilhete inteiro na", en: "Open the whole ticket at" },
  alsoAt: { pt: "também na", en: "also at" },
  // Partial coverage: the link carries part of the ticket and says so, names what is missing and why.
  ofLines: { pt: "linhas", en: "lines" },
  ofOne: { pt: "linha", en: "line" },
  withLines: { pt: "com", en: "with" },
  ofTotal: { pt: "das", en: "of" },
  missing: { pt: "falta", en: "missing" },
  missingMany: { pt: "faltam", en: "missing" },
  reasonLine: { pt: "a casa não publica essa linha", en: "the book does not post this line" },
  reasonMarket: { pt: "a casa não cota esse mercado", en: "the book does not price this market" },
  linkPays: { pt: "o link paga", en: "the link pays" },
  // What the link carries, when it is less than what the book prices: the button says the smaller
  // number and this line says the bigger one, so neither fact has to be guessed from the other.
  openPageAt: { pt: "Abrir a página na", en: "Open the page at" },
  bookPrices: { pt: "a casa cota", en: "the book prices" },
  bookPricesAll: { pt: "a casa cota as", en: "the book prices all" },
  bookPricesThis: { pt: "a casa cota essa linha", en: "the book prices this line" },
  butLinkCarries: { pt: "mas o link carrega só", en: "but the link only carries" },
  butLinkOpensPage: { pt: "mas o link só abre a página: o bilhete tem que ser montado lá", en: "but the link only opens the page: the ticket has to be built there" },
  // The near line: a DIFFERENT bet, offered on its own row and never counted as coverage.
  nearLine: { pt: "linha parecida", en: "close line" },
  insteadOf: { pt: "em vez de", en: "instead of" },
  pays: { pt: "paga", en: "pays" },
  otherBet: { pt: "é outra aposta, não a do bilhete", en: "a different bet, not the ticket's" },
  otherBooks: { pt: "outras casas", en: "other books" },
  noSlip: { pt: "nenhuma casa lida tem essas linhas: não há link para montar esse bilhete", en: "no book we read has these lines: there is no link that builds this ticket" },
  slipReady: { pt: "bilhete pronto", en: "slip ready" },
  gamePage: { pt: "página do jogo", en: "game page" },
  marketPage: { pt: "página do mercado", en: "market page" },
  newTab: { pt: "abre em nova aba", en: "opens in a new tab" },
  unverified: { pt: "link montado pelo esquema público da casa, ainda não testado por nós", en: "link built from the book's public scheme, not yet tested by us" },
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

/**
 * What the button may promise, counted off the URL and never off the coverage: "Abrir o bilhete
 * inteiro na Superbet" only when the link itself puts every leg of the ticket in the slip; "Abrir
 * na Superbet com 3 das 4 linhas" when it puts some of them there; "Abrir a página na Betnacional"
 * when it puts none, because there is no ticket at the other end of that tap.
 *
 * The number is never rounded up and never implied. A book can price every leg and still hand over
 * a one-selection URL (a covered row without the platform's deep-link ids), and the whole reason
 * `carried` exists is that a reader must not be able to read "abrir o bilhete" off it.
 */
export function candidateLabel(c: BookCandidate, of: number, lang: Lang): string {
  const t = booksCopy(lang);
  const n = (x: number) => formatNumber(x, lang, { digits: 0 });
  if (!c.carried.length) return `${t("openPageAt")} ${c.book}`;
  if (c.carried.length === of && c.link.kind === "betslip") return `${t("openTicketAt")} ${c.book}`;
  return `${t("openAt")} ${c.book} ${t("withLines")} ${n(c.carried.length)} ${t("ofTotal")} ${n(of)} ${of === 1 ? t("ofOne") : t("ofLines")}`;
}

/**
 * The distance between what the book prices and what its link carries, said out loud whenever the
 * two differ: "a casa cota 3 das 3 linhas, mas o link carrega só 1", or "…, mas o link só abre a
 * página: o bilhete tem que ser montado lá". The button is bound to the smaller number, so this is
 * where the bigger one — the good news about the book — gets to be true as well. Null when the link
 * carries exactly what the book covers: then the button already said everything there is to say.
 */
export function reachNote(c: BookCandidate, of: number, lang: Lang): string | null {
  if (c.carried.length === c.covered.length) return null;
  const t = booksCopy(lang);
  const n = (x: number) => formatNumber(x, lang, { digits: 0 });
  // "a casa cota as 3 linhas" reads like Portuguese; "a casa cota 3 das 3 linhas" reads like a form.
  const covers = c.covered.length === of
    ? of === 1 ? t("bookPricesThis") : `${t("bookPricesAll")} ${n(of)} ${t("ofLines")}`
    : `${t("bookPrices")} ${n(c.covered.length)} ${t("ofTotal")} ${n(of)} ${t("ofLines")}`;
  return `${covers}, ${c.carried.length ? `${t("butLinkCarries")} ${n(c.carried.length)}` : t("butLinkOpensPage")}`;
}
