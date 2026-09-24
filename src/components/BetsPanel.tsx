"use client";

import { useState } from "react";

import { Empty, Odds, Skeleton, chipClass, cx, useIsPhone } from "@/components/ui";
import { formatOdds } from "@/lib/format";
import { groupAlternatives } from "@/lib/bets/alternatives-view";
import { getBand } from "@/lib/odds";
import { makeT, type Lang } from "@/lib/i18n";
import type { BetSlate, BetSuggestion } from "@/lib/types";
import { PricesMeta, PropSignalsList, TicketBookButton, type TicketPricesView } from "@/components/PriceComparison";
import { TicketDetails, type LegAlertView } from "@/components/TicketDetails";
import { TicketStake } from "@/components/TicketStake";
import type { PropSignal } from "@/lib/sources/br-books/compare";

export type { LegAlertView };
export { Movement, expectedLosers } from "@/components/TicketDetails";

/**
 * A ticket, drawn the way a betting slip is drawn — because that is the thing a reader recognises
 * and the thing they take a screenshot of: the ticket's name and its combined price, then one line
 * per selection with its own price, then the two things there are to do with it.
 *
 * Everything else the product knows about the ticket — the modelled chance, the EV, the evidence
 * score and its notes, the band, the correlation, each line's explanation, evidence and measured
 * record, the lineup alerts, the whole of "Onde apostar" and the alternatives — is one tap away in
 * `TicketDetails`, which the whole card opens. Nothing was removed; it was moved off the face.
 *
 * The one number that cannot move is the chance beside the price: a multiplier is never printed on
 * its own (docs/DESIGN.md §13), so the combined price is rendered by `<Odds>`, which refuses to
 * draw half the pair.
 */
function Ticket({ bet, lang, gameId, sportKey, alerts = [], alternatives = [], prices = null, booksRead = 0, className = "" }: { bet: BetSuggestion; lang: Lang; gameId?: string; sportKey?: string; alerts?: LegAlertView[]; alternatives?: BetSuggestion[]; prices?: TicketPricesView | null; booksRead?: number; className?: string }) {
  const t = makeT(lang);
  const [open, setOpen] = useState(false);

  return (
    <li className={cx("rounded-panel border border-line bg-surface-1", className)} data-testid="ticket" data-band={bet.bandKey}>
      {/* The slip itself is the door to everything behind it. A real button, so Enter and Space
          open it and a screen reader is told it opens a dialog. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${bet.title} — ${t("ticketOpenDetails")}`}
        data-testid="ticket-face"
        className="u-ring-inset flex w-full flex-col gap-2 px-3.5 py-3 text-left transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-surface-2"
      >
        <span className="flex w-full items-start gap-3">
          <span className="min-w-0 flex-1 text-sm leading-snug font-semibold text-fg">{bet.title}</span>
          <Odds decimal={bet.combinedDecimal} probability={bet.modelledProbability} lang={lang} className="shrink-0 text-lead" />
        </span>
        <ol className="flex w-full flex-col" data-testid="ticket-lines">
          {bet.legs.map((leg, i) => (
            <li key={i} className="flex items-baseline gap-3 py-1.5 u-rule last:shadow-none" data-testid="ticket-line">
              <span className="min-w-0 flex-1 text-tiny leading-snug text-fg-muted">{leg.selection}</span>
              <span className="nums shrink-0 text-tiny text-fg">{formatOdds(leg.oddsDecimal, lang)}</span>
            </li>
          ))}
        </ol>
      </button>

      {/* The two actions, in the order a reader uses them: place it, then log it. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-2.5" data-testid="ticket-bankroll">
        <TicketBookButton ticket={prices} lang={lang} ctx={{ gameId, ticketId: bet.id }} onDetails={() => setOpen(true)} detailsLabel={t("ticketOpenDetails")} />
        {gameId && <TicketStake bet={bet} lang={lang} gameId={gameId} />}
      </div>

      <TicketDetails
        open={open}
        onClose={() => setOpen(false)}
        bet={bet}
        lang={lang}
        gameId={gameId}
        sportKey={sportKey}
        alerts={alerts}
        alternatives={alternatives}
        prices={prices}
        booksRead={booksRead}
      />
    </li>
  );
}

export interface GamePricesView { tickets: TicketPricesView[]; signals: PropSignal[]; books: string[]; fetchedAt: string | null }

/**
 * The phone's way through a stack of tickets: one chip per odds band present, swiped sideways,
 * each a pressed/unpressed toggle (§12.6) that leaves only that band's tickets on screen. A desk
 * shows every ticket and the strip is not in its DOM at all — hidden, its labels ("Longa
 * (20x–100x)") would still answer a search for a price.
 */
function BandChips({ bands, band, onBand, lang }: { bands: string[]; band: string; onBand: (key: string) => void; lang: Lang }) {
  const t = makeT(lang);
  const phone = useIsPhone();
  if (!phone || bands.length < 2) return null;
  return (
    <div className="u-swipe -mx-(--panel-p) gap-2 px-(--panel-p)" role="group" aria-label={lang === "pt" ? "Faixa de odds" : "Odds band"} data-testid="band-chips">
      <button type="button" aria-pressed={band === "all"} onClick={() => onBand("all")} className={chipClass(band === "all")}>{t("allBands")}</button>
      {bands.map((key) => (
        <button key={key} type="button" aria-pressed={band === key} onClick={() => onBand(key)} className={chipClass(band === key)} data-testid={`band-${key}`}>
          {getBand(key).label[lang]}
        </button>
      ))}
    </div>
  );
}

/** Two slips in the final shape — title, price, ruled lines, the action row — while the real ones arrive. */
export function TicketSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3" data-testid="tickets-loading">
      <span className="sr-only">{label}</span>
      {[0, 1].map((i) => (
        <div key={i} aria-hidden="true" className="rounded-panel border border-line bg-surface-1">
          <div className="flex flex-col gap-2 px-3.5 py-3">
            <div className="flex items-start gap-3">
              <Skeleton width={i ? "9rem" : "11rem"} className="h-4" />
              <Skeleton width="4.5rem" className="ml-auto h-5" />
            </div>
            <div className="flex flex-col">
              {[0, 1, 2].map((leg) => (
                <div key={leg} className="flex items-center gap-3 py-2 u-rule last:shadow-none">
                  <Skeleton width={`${40 + ((leg * 19) % 30)}%`} className="h-3" />
                  <Skeleton width="2.5rem" className="ml-auto" />
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2 border-t border-line px-3.5 py-2.5">
            <Skeleton width="11rem" className="h-(--row-h)" />
            <Skeleton width="8rem" className="h-(--row-h)" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function BetsPanel({ slate, lang, gameId, sportKey, alerts = [], prices = null }: { slate: BetSlate | null | undefined; lang: Lang; gameId?: string; sportKey?: string; alerts?: LegAlertView[]; prices?: GamePricesView | null }) {
  const t = makeT(lang);
  const [band, setBand] = useState("all");
  if (!slate?.suggestions.length) {
    return (
      <>
        <Empty>{t("noBets")}</Empty>
        {slate?.dataNote && <p className="mt-2 text-tiny leading-relaxed text-fg-dim">{slate.dataNote}</p>}
      </>
    );
  }

  const groups = groupAlternatives(slate.suggestions);
  const bands = [...new Set(groups.map((g) => g.main.bandKey))].sort((a, b) => getBand(a).min - getBand(b).min);
  const shown = bands.includes(band) ? band : "all";

  return (
    <div className="flex flex-col gap-3">
      <BandChips bands={bands} band={shown} onBand={setBand} lang={lang} />
      {prices && <PricesMeta books={prices.books} fetchedAt={prices.fetchedAt} lang={lang} />}
      {prices?.signals.length && sportKey ? <PropSignalsList signals={prices.signals} sportKey={sportKey} lang={lang} /> : null}
      <ul className="flex flex-col gap-3">
        {groups.map(({ main, alternatives }) => (
          <Ticket key={main.id} bet={main} lang={lang} gameId={gameId} sportKey={sportKey} alerts={alerts.filter((a) => a.suggestionId === main.id)} alternatives={alternatives} prices={prices?.tickets.find((p) => p.suggestionId === main.id) ?? null} booksRead={prices?.books.length ?? 0} className={shown !== "all" && main.bandKey !== shown ? "max-md:hidden" : ""} />
        ))}
      </ul>
      {slate.dataNote && (
        <p className="border-t border-line pt-2.5 text-tiny leading-relaxed text-fg-dim">{slate.dataNote}</p>
      )}
    </div>
  );
}
