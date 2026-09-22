import { formatNumber, formatOdds, formatPercent } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import { getSport } from "@/lib/sports";
import type { LegComparison, PropSignal, TicketComparison } from "@/lib/sources/br-books/compare";
import { booksCopy, feedsLabel, relativeMinutes, sideLabel } from "@/components/books-copy";

/**
 * The books' verdict on a leg and on a ticket, drawn in the ticket's own type: one dense line per
 * leg (best book and price, how far above the worst), one ruled block per ticket (the whole ticket
 * at the best single book, the ceiling if every leg were taken at its own best). Book names are
 * printed — they are prices, and a reader has to know where to go. Colour only where it means
 * something: a positive delta is a gain (pos); "out of step" is a caution (warn).
 */
export type TicketPricesView = Omit<TicketComparison, "legs"> & { suggestionId: string; legs: (LegComparison | null)[] };

const pct = (n: number, lang: Lang) => formatPercent(n / 100, lang, { digits: 1, signed: true });

export function LegPrices({ leg, lang }: { leg: LegComparison | null; lang: Lang }) {
  const t = booksCopy(lang);
  if (!leg) return null;
  if (!leg.best) return <span className="nums text-micro text-fg-dim" data-testid="leg-prices-none">{t("noQuote")}</span>;
  const alt = leg.lineAlternatives.find((a) => a.better);
  const off = leg.dispersion[0];
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
    </span>
  );
}

export function TicketPrices({ ticket, lang }: { ticket: TicketPricesView; lang: Lang }) {
  const t = booksCopy(lang);
  const anyQuote = ticket.legs.some((l) => l?.best);
  if (!anyQuote) return null;
  const runners = ticket.perBook.filter((b) => b.priced === b.of).slice(0, 4);
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
