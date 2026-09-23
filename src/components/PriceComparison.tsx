import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { buttonClass } from "@/components/ui";
import { formatNumber, formatOdds, formatPercent } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import { getSport } from "@/lib/sports";
import type { LegComparison, PropSignal, TicketComparison } from "@/lib/sources/br-books/compare";
import type { DeepLink } from "@/lib/sources/br-books/deeplinks";
import { track } from "@/lib/track";
import { booksCopy, feedsLabel, relativeMinutes, sideLabel } from "@/components/books-copy";

/**
 * The books' verdict on a leg and on a ticket, drawn in the ticket's own type: one dense line per
 * leg (best book and price, how far above the worst), one ruled block per ticket (the whole ticket
 * at the best single book, the ceiling if every leg were taken at its own best). Book names are
 * printed — they are prices, and a reader has to know where to go. Colour only where it means
 * something: a positive delta is a gain (pos); "out of step" is a caution (warn).
 *
 * "Onde apostar" also opens the door: under a leg, a link that opens the best book with that
 * selection already in the betslip (or its event / market page where the book's URL cannot carry a
 * selection), the other books that price the leg after it; under a ticket, one link that carries
 * every leg into the best single book's slip when that book's scheme takes a whole ticket. The
 * product never places a bet: the link is the book's own public URL, opened in a new tab.
 */
export type LegPricesView = LegComparison & { links?: DeepLink[] };
export type TicketPricesView = Omit<TicketComparison, "legs"> & { suggestionId: string; legs: (LegPricesView | null)[]; ticketLink?: DeepLink | null };

/** Where a click goes, for the outbound event: which ticket, which leg (or the whole ticket). */
export interface LinkContext { gameId?: string; ticketId?: string; legIndex?: number }

const pct = (n: number, lang: Lang) => formatPercent(n / 100, lang, { digits: 1, signed: true });

const kindLabel = (kind: DeepLink["kind"], t: ReturnType<typeof booksCopy>) => (kind === "betslip" ? t("slipReady") : kind === "market" ? t("marketPage") : t("gamePage"));

function trackClick(link: DeepLink, ctx: LinkContext, what: "leg" | "ticket") {
  track("book_click", { book: link.book, gameId: ctx.gameId ?? "", ticketId: ctx.ticketId ?? "", legIndex: ctx.legIndex ?? -1, kind: what, deep: link.kind === "betslip", verified: link.verified });
}

/** The book's own page in a new tab, never in ours: rel="noopener" so it cannot reach back. */
function BookLink({ link, ctx, what, lang, className, children }: { link: DeepLink; ctx: LinkContext; what: "leg" | "ticket"; lang: Lang; className: string; children: ReactNode }) {
  const t = booksCopy(lang);
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={`${kindLabel(link.kind, t)} · ${t("newTab")}${link.verified ? "" : ` · ${t("unverified")}`}`}
      data-testid={what === "leg" ? "leg-open-book" : "ticket-open-book"}
      data-book={link.book}
      data-kind={link.kind}
      data-verified={link.verified ? "1" : "0"}
      onClick={() => trackClick(link, ctx, what)}
    >
      {children}
    </a>
  );
}

export function LegPrices({ leg, lang, ctx = {} }: { leg: LegPricesView | null; lang: Lang; ctx?: LinkContext }) {
  const t = booksCopy(lang);
  if (!leg) return null;
  if (!leg.best) return <span className="nums text-micro text-fg-dim" data-testid="leg-prices-none">{t("noQuote")}</span>;
  const alt = leg.lineAlternatives.find((a) => a.better);
  const off = leg.dispersion[0];
  // The best book's link first (the links come best-first); the rest of the books after it.
  const links = leg.links ?? [];
  const [first, ...others] = links;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 nums text-micro text-fg-dim" data-testid="leg-prices">
      <span>
        {leg.quotes.length === 1 ? t("onlyBook") : t("bestPrice")}: <span className="text-fg">{leg.best.book} {formatOdds(leg.best.decimal, lang)}</span>
        {leg.bestVsWorstPct !== null && leg.bestVsWorstPct > 0 && (
          <span className="text-pos"> {pct(leg.bestVsWorstPct, lang)} {t("vsWorst")} ({leg.worst!.book} {formatOdds(leg.worst!.decimal, lang)})</span>
        )}
      </span>
      {leg.fair && (
        <span title={leg.fair.source === "exchange" ? "Betfair Exchange back/lay midpoint" : "no-vig mean of the books posting both sides"}>
          {t("fair")} {formatOdds(leg.fair.decimal, lang)} {leg.fair.source === "exchange" ? `(${t("exchange")})` : ""}
        </span>
      )}
      {off && (
        <span className="text-warn" data-testid="leg-dispersion">
          {t("offConsensus")}: {off.book} {formatOdds(off.decimal, lang)} {pct(off.pct, lang)} · {t("median")} {formatOdds(off.othersMedian, lang)} ({feedsLabel(off.others, off.otherBooks, lang)})
        </span>
      )}
      {alt && leg.query.market === "player_prop" && (leg.query.side === "over" || leg.query.side === "under") && (
        <span className="text-warn" data-testid="leg-line-alt">
          {t("betterLine")}: {sideLabel(leg.query.side, lang)} {formatNumber(alt.line, lang, { digits: 1 })} @ {formatOdds(alt.decimal, lang)} {t("at")} {alt.book}
        </span>
      )}
      {alt && leg.query.market !== "player_prop" && (
        <span className="text-warn" data-testid="leg-line-alt">
          {t("betterLine")}: {formatNumber(alt.line, lang, { digits: 1 })} @ {formatOdds(alt.decimal, lang)} {t("at")} {alt.book}
        </span>
      )}
      {first && (
        <span className="font-sans" data-testid="leg-links">
          <BookLink link={first} ctx={ctx} what="leg" lang={lang} className="inline-flex items-center gap-1 font-medium text-fg underline decoration-line-control underline-offset-2 hover:decoration-fg max-md:min-h-11">
            {t("openAt")} {first.book}
            <Icon name="external" size={16} className="text-fg-dim" />
          </BookLink>
          <span className={first.kind === "betslip" ? "text-pos" : "text-fg-dim"}> · {kindLabel(first.kind, t)}</span>
          {others.length > 0 && (
            <span className="text-fg-dim">
              {" "}· {t("alsoAt")}{" "}
              {others.slice(0, 4).map((l, i) => (
                <span key={l.book}>
                  {i > 0 && ", "}
                  <BookLink link={l} ctx={ctx} what="leg" lang={lang} className="inline-flex items-center underline decoration-line-control underline-offset-2 hover:text-fg hover:decoration-fg max-md:min-h-11">
                    {l.book}
                  </BookLink>
                </span>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

export function TicketPrices({ ticket, lang, ctx = {} }: { ticket: TicketPricesView; lang: Lang; ctx?: LinkContext }) {
  const t = booksCopy(lang);
  const anyQuote = ticket.legs.some((l) => l?.best);
  if (!anyQuote) return null;
  const runners = ticket.perBook.filter((b) => b.priced === b.of).slice(0, 4);
  const ticketLink = ticket.ticketLink ?? null;
  return (
    <div className="mt-3 border-t border-line pt-2.5" data-testid="ticket-prices">
      <h4 className="text-micro u-label text-fg-dim">{t("whereToBet")}</h4>
      <dl className="mt-1 flex flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 text-tiny">
          <dt className="text-fg-muted">{t("bestSingle")}:</dt>
          {ticket.bestSingleBook ? (
            <dd className="nums text-fg" data-testid="ticket-best-book">
              {ticket.bestSingleBook.book} <span className="font-medium">{formatOdds(ticket.bestSingleBook.decimal, lang)}x</span>
              {ticket.bestSingleVsReferencePct !== null && ticket.bestSingleVsReferencePct !== 0 && (
                <span className={ticket.bestSingleVsReferencePct > 0 ? "text-pos" : "text-fg-dim"}> {pct(ticket.bestSingleVsReferencePct, lang)} {t("vsTicket")}</span>
              )}
            </dd>
          ) : (
            <dd className="text-fg-dim">{t("noSingleBook")}</dd>
          )}
        </div>
        {ticket.theoreticalBest !== null && (
          <div className="flex flex-wrap items-baseline gap-x-2 text-tiny">
            <dt className="text-fg-muted">{t("theoretical")}:</dt>
            <dd className="nums text-fg" data-testid="ticket-theoretical">
              {formatOdds(ticket.theoreticalBest, lang)}x
              {ticket.theoreticalVsReferencePct !== null && ticket.theoreticalVsReferencePct > 0 && <span className="text-pos"> {pct(ticket.theoreticalVsReferencePct, lang)}</span>}
              {ticket.legs.length > 1 && <span className="text-fg-dim"> · {t("notPlaceable")}</span>}
            </dd>
          </div>
        )}
        {runners.length > 1 && (
          <div className="flex flex-wrap items-baseline gap-x-2 text-label text-fg-dim">
            {runners.map((b) => (
              <span key={b.book} className="nums">{b.book} {formatOdds(b.decimal, lang)}x</span>
            ))}
          </div>
        )}
      </dl>
      {ticketLink && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="ticket-link">
          <BookLink link={ticketLink} ctx={ctx} what="ticket" lang={lang} className={buttonClass("secondary", "text-tiny")}>
            {t("openTicketAt")} {ticketLink.book}
            <Icon name="external" size={16} className="text-fg-dim" />
          </BookLink>
          <span className={`text-micro ${ticketLink.kind === "betslip" ? "text-pos" : "text-fg-dim"}`}>
            {kindLabel(ticketLink.kind, t)}{ticketLink.selections > 1 ? ` · ${ticketLink.selections} ${lang === "pt" ? "linhas" : "legs"}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

/** The event's player lines where a book is out of step: a short ruled list above the tickets. */
export function PropSignalsList({ signals, sportKey, lang }: { signals: PropSignal[]; sportKey: string; lang: Lang }) {
  const t = booksCopy(lang);
  if (!signals.length) return null;
  const label = (stat: string) => getSport(sportKey).markets.find((m) => m.key === stat)?.label[lang] ?? stat;
  return (
    <div className="mb-3 border-l-2 border-warn pl-3" data-testid="prop-signals">
      <p className="text-micro u-label text-warn">{t("signals")}</p>
      <p className="text-label text-fg-dim">{t("signalsHint")}</p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {signals.map((s) => {
          const off = s.comparison.dispersion[0];
          const alt = s.comparison.lineAlternatives.find((a) => a.better);
          return (
            <li key={`${s.player}-${s.stat}-${s.side}-${s.line}`} className="nums text-tiny text-fg-muted">
              <span className="text-fg">{s.player}</span> {label(s.stat)} {sideLabel(s.side, lang)} {formatNumber(s.line, lang, { digits: 1 })}
              {off && <> — {off.book} {formatOdds(off.decimal, lang)} <span className="text-warn">{pct(off.pct, lang)}</span> ({t("median")} {formatOdds(off.othersMedian, lang)}: {feedsLabel(off.others, off.otherBooks, lang)})</>}
              {!off && alt && s.comparison.best && <> — {s.comparison.best.book} {formatOdds(s.comparison.best.decimal, lang)}; {alt.book} {sideLabel(s.side, lang)} {formatNumber(alt.line, lang, { digits: 1 })} @ {formatOdds(alt.decimal, lang)}</>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "10 casas lidas · atualizado há 12 min": when the numbers under the tickets were read. */
export function PricesMeta({ books, fetchedAt, lang, now }: { books: string[]; fetchedAt: string | null; lang: Lang; now?: number }) {
  const t = booksCopy(lang);
  if (!books.length || !fetchedAt) return null;
  return (
    <p className="mb-2 nums text-micro text-fg-dim" data-testid="prices-meta">
      {books.length} {t("booksRead")} · {t("updated")} {relativeMinutes(fetchedAt, lang, now)}
    </p>
  );
}
