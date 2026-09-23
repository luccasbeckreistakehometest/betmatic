import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { buttonClass } from "@/components/ui";
import { formatNumber, formatOdds, formatPercent } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import { getSport } from "@/lib/sports";
import type { LegComparison, PropSignal, TicketComparison } from "@/lib/sources/br-books/compare";
import type { BookCandidate, NearLine, TicketSlip } from "@/lib/sources/br-books/coverage";
import type { DeepLink } from "@/lib/sources/br-books/deeplinks";
import { track } from "@/lib/track";
import { booksCopy, candidateLabel, feedsLabel, reachNote, relativeMinutes, sideLabel } from "@/components/books-copy";

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
export type TicketPricesView = Omit<TicketComparison, "legs"> & { suggestionId: string; legs: (LegPricesView | null)[]; slip?: TicketSlip | null };

/** Where a click goes, for the outbound event: which ticket, which leg (or the whole ticket). */
export interface LinkContext { gameId?: string; ticketId?: string; legIndex?: number }

const pct = (n: number, lang: Lang) => formatPercent(n / 100, lang, { digits: 1, signed: true });

const kindLabel = (kind: DeepLink["kind"], t: ReturnType<typeof booksCopy>) => (kind === "betslip" ? t("slipReady") : kind === "market" ? t("marketPage") : t("gamePage"));

/**
 * The outbound event. `coverage` and `covered` are what the reader was actually offered when they
 * clicked — a whole ticket, part of one and how much of it, or a near line — so the question "which
 * books do people place on, and do they accept a partial slip" has an answer in the data. `carried`
 * is what the URL itself pre-filled, which is the smaller number whenever a book prices a leg on a
 * row with no deep-link ids: without it the data would read as if the reader had been handed a
 * whole ticket they were never handed.
 */
type ClickCoverage = "full" | "partial" | "near";

function trackClick(link: DeepLink, ctx: LinkContext, what: "leg" | "ticket", coverage: ClickCoverage, covered: number) {
  track("book_click", { book: link.book, gameId: ctx.gameId ?? "", ticketId: ctx.ticketId ?? "", legIndex: ctx.legIndex ?? -1, kind: what, deep: link.kind === "betslip", verified: link.verified, coverage, covered, carried: link.selections });
}

/** The book's own page in a new tab, never in ours: rel="noopener" so it cannot reach back. */
function BookLink({ link, ctx, what, lang, className, coverage = "full", covered = 1, testId, children }: { link: DeepLink; ctx: LinkContext; what: "leg" | "ticket"; lang: Lang; className: string; coverage?: ClickCoverage; covered?: number; testId?: string; children: ReactNode }) {
  const t = booksCopy(lang);
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={`${kindLabel(link.kind, t)} · ${t("newTab")}${link.verified ? "" : ` · ${t("unverified")}`}`}
      data-testid={testId ?? (what === "leg" ? "leg-open-book" : "ticket-open-book")}
      data-book={link.book}
      data-kind={link.kind}
      data-verified={link.verified ? "1" : "0"}
      data-coverage={coverage}
      data-covered={covered}
      data-carried={link.selections}
      onClick={() => trackClick(link, ctx, what, coverage, covered)}
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

/** "mais de 20,5" for a prop or a total; a spread or a moneyline rung is named by its own number. */
function lineLabel(side: NearLine["side"], line: number, lang: Lang): string {
  const n = formatNumber(line, lang, { digits: 1 });
  return side === "over" || side === "under" ? `${sideLabel(side, lang)} ${n}` : n;
}

/** "falta: Kiki Iriafen menos de 16,5 pontos — a casa não publica essa linha". */
function missingLabel(c: BookCandidate, legNames: string[], lang: Lang, t: ReturnType<typeof booksCopy>): string {
  const name = (i: number) => legNames[i] ?? `${lang === "pt" ? "linha" : "leg"} ${i + 1}`;
  const reason = (r: "line" | "market") => t(r === "line" ? "reasonLine" : "reasonMarket");
  const head = c.missing.length === 1 ? t("missing") : t("missingMany");
  const reasons = new Set(c.missing.map((m) => m.reason));
  if (reasons.size === 1) return `${head}: ${c.missing.map((m) => name(m.index)).join(", ")} — ${reason(c.missing[0].reason)}`;
  return `${head}: ${c.missing.map((m) => `${name(m.index)} (${reason(m.reason)})`).join(", ")}`;
}

/**
 * The closest thing the books have to a leg they do not post: the same player and stat one rung
 * away, named as what it is. It is drawn as its own row, in the caution tone, with both prices side
 * by side and the words "é outra aposta" on it — it is never folded into the coverage count above
 * it, and its price is never multiplied into the ticket's.
 */
function NearLineRow({ near, legNames, lang, ctx }: { near: NearLine; legNames: string[]; lang: Lang; ctx: LinkContext }) {
  const t = booksCopy(lang);
  // The player alone on a prop — the leg's own text already carries the line, and repeating it
  // ("Bia Souza mais de 6,5 — mais de 7,5 em vez de mais de 6,5") reads as two different bets.
  const name = near.player ?? legNames[near.index] ?? `${lang === "pt" ? "linha" : "leg"} ${near.index + 1}`;
  const prices = near.from.decimal
    ? ` (${t("pays")} ${formatOdds(near.to.decimal, lang)} ${t("insteadOf")} ${formatOdds(near.from.decimal, lang)})`
    : ` (${t("pays")} ${formatOdds(near.to.decimal, lang)})`;
  return (
    <p className="nums mt-1.5 border-l-2 border-warn pl-2 text-micro leading-relaxed text-fg-dim" data-testid="ticket-near-line" data-book={near.book} data-leg={near.index}>
      <span className="text-warn">{t("nearLine")}</span>: {name} — {lineLabel(near.side, near.to.line, lang)} {t("insteadOf")} {formatNumber(near.from.line, lang, { digits: 1 })}{prices}{" "}
      {near.link ? (
        <BookLink link={near.link} ctx={{ ...ctx, legIndex: near.index }} what="ticket" lang={lang} coverage="near" covered={0} testId="ticket-near-open"
          className="font-sans font-medium text-fg underline decoration-line-control underline-offset-2 hover:decoration-fg max-md:inline-flex max-md:min-h-11 max-md:items-center">
          {t("at")} {near.book}
        </BookLink>
      ) : (
        <span className="font-sans">{t("at")} {near.book}</span>
      )}
      <span className="font-sans"> · {t("otherBet")}</span>
    </p>
  );
}

/** One runner-up book inside "outras casas": its coverage, its price, its link. */
function CandidateLink({ c, of, lang, ctx, t }: { c: BookCandidate; of: number; lang: Lang; ctx: LinkContext; t: ReturnType<typeof booksCopy> }) {
  return (
    <li className="nums text-micro text-fg-dim">
      <BookLink link={c.link} ctx={ctx} what="ticket" lang={lang} coverage={c.full ? "full" : "partial"} covered={c.covered.length} testId="ticket-other-open"
        className="font-sans font-medium text-fg underline decoration-line-control underline-offset-2 hover:decoration-fg max-md:inline-flex max-md:min-h-11 max-md:items-center">
        {candidateLabel(c, of, lang)}
      </BookLink>
      {" "}· {c.carriedDecimal !== null ? `${t("linkPays")} ${formatOdds(c.carriedDecimal, lang)}x` : `${t("bookPrices")} ${formatOdds(c.decimal, lang)}x`}
      {" "}· <span className={c.link.kind === "betslip" ? "text-pos" : "text-fg-dim"}>{kindLabel(c.link.kind, t)}</span>
    </li>
  );
}

/**
 * "Onde apostar", rewritten around one question: where can the reader place THIS ticket in one tap?
 *
 * One primary link, always the most of the ticket a single book can carry, labelled with exactly
 * how much that is and what the link itself pays. Under it, when a leg is missing, what is missing
 * and why, and — separately, marked as a different bet — the closest rung a book does post. The
 * price comparison that used to sit here (the whole ticket at the best single book, the ceiling if
 * every leg were taken at its own best book, the other books' totals) is information, not an
 * action, so it moves one tap away into "outras casas": a whole ticket beats a better price.
 */
export function TicketPrices({ ticket, lang, ctx = {}, legNames = [], booksRead = 0 }: { ticket: TicketPricesView; lang: Lang; ctx?: LinkContext; legNames?: string[]; booksRead?: number }) {
  const t = booksCopy(lang);
  const slip = ticket.slip ?? null;
  const anyQuote = ticket.legs.some((l) => l?.best);
  const best = slip?.best ?? null;
  const nearLines = slip?.nearLines ?? [];
  // Nothing was read for this game at all: the panel stays silent rather than announcing an absence
  // the reader cannot act on. Books were read and this ticket's lines are not among them: say so.
  if (!anyQuote && !best && !nearLines.length && booksRead === 0) return null;
  const of = slip?.legs ?? ticket.legs.length;
  const runners = ticket.perBook.filter((b) => b.priced === b.of).slice(0, 4);
  const others = (slip?.others ?? []).slice(0, 3);
  // What the book covers, when the link carries less than that: null when there is nothing to add.
  const reach = best ? reachNote(best, of, lang) : null;
  return (
    <div className="mt-3 border-t border-line pt-2.5" data-testid="ticket-prices" data-coverage={slip?.kind ?? "none"}>
      <h4 className="text-micro u-label text-fg-dim">{t("whereToBet")}</h4>
      {best ? (
        <div className="mt-1.5" data-testid="ticket-link">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <BookLink link={best.link} ctx={ctx} what="ticket" lang={lang} coverage={best.full ? "full" : "partial"} covered={best.covered.length} className={buttonClass("secondary", "text-tiny")}>
              {candidateLabel(best, of, lang)}
              <Icon name="external" size={16} className="text-fg-dim" />
            </BookLink>
            <span className="nums text-micro text-fg-dim">
              <span className={best.link.kind === "betslip" ? "text-pos" : "text-fg-dim"}>{kindLabel(best.link.kind, t)}</span>
              {/* The price of what the URL carries, and nothing when it carries nothing: a page has
                  no price of its own, and the covered legs' product printed beside it would read as
                  one. */}
              {best.carriedDecimal !== null && <> · {t("linkPays")} <span className="text-fg">{formatOdds(best.carriedDecimal, lang)}x</span></>}
            </span>
          </div>
          {reach && <p className="nums mt-1 text-micro leading-relaxed text-fg-muted" data-testid="ticket-link-reach">{reach}</p>}
          {best.missing.length > 0 && (
            <p className="mt-1 text-micro leading-relaxed text-fg-muted" data-testid="ticket-missing">{missingLabel(best, legNames, lang, t)}</p>
          )}
        </div>
      ) : (
        <p className="mt-1.5 text-micro leading-relaxed text-fg-dim" data-testid="ticket-no-slip">{t("noSlip")}</p>
      )}
      {nearLines.slice(0, 2).map((n) => <NearLineRow key={`${n.index}-${n.book}`} near={n} legNames={legNames} lang={lang} ctx={ctx} />)}
      {(others.length > 0 || ticket.bestSingleBook || ticket.theoreticalBest !== null) && (
        <details className="group mt-2" data-testid="ticket-other-books">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-micro text-fg-dim hover:text-fg max-md:min-h-11">
            <span className="transition-transform duration-(--dur-1) ease-(--ease-out) group-open:rotate-90">›</span>
            {t("otherBooks")}
          </summary>
          {others.length > 0 && <ul className="mt-1 flex flex-col gap-0.5">{others.map((c) => <CandidateLink key={c.book} c={c} of={of} lang={lang} ctx={ctx} t={t} />)}</ul>}
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
        </details>
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
