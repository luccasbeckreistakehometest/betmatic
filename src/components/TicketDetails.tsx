"use client";

import Link from "next/link";
import { track } from "@/lib/track";

import { Badge, Chip, Odds, cx } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { formatNumber, formatOdds, formatPercent as pctOf } from "@/lib/format";
import { legDiff } from "@/lib/bets/alternatives-view";
import { formatDecimal, getBand } from "@/lib/odds";
import { makeT, type Lang } from "@/lib/i18n";
import type { BetLeg, BetSuggestion } from "@/lib/types";
import { LegPrices, TicketPrices, type TicketPricesView } from "@/components/PriceComparison";

/**
 * Everything a ticket knows, one tap behind the card that names it.
 *
 * The card on the page is a betting slip: the ticket, its lines, their prices, and the two things a
 * reader does with it. Nothing was deleted to get there — the chance, the EV, the evidence score,
 * the band, the correlation, each line's explanation and measured record, the whole of "Onde
 * apostar" and the alternatives all live here, in the order a reader asks for them: what is this,
 * what are the lines, what are the numbers, what could go wrong, where do I place it.
 *
 * On a phone it is a bottom sheet inside a thumb's reach; on a desk the same content in a centred
 * dialog. Both come from `Modal`, so Esc, the backdrop, the close button and the phone's own back
 * gesture all dismiss it, and focus is trapped while it is open.
 */

/** A leg alert from the lineup watcher, keyed by suggestion id and leg index. */
export interface LegAlertView { suggestionId: string; legIndex: number; kind: "bench" | "out" | "doubt" | "key_absence"; player: string }

const ALERT_LABEL: Record<LegAlertView["kind"], { pt: string; en: string }> = {
  bench: { pt: "em risco: no banco", en: "at risk: benched" },
  out: { pt: "em risco: fora do jogo", en: "at risk: ruled out" },
  doubt: { pt: "em risco: dúvida", en: "at risk: doubtful" },
  key_absence: { pt: "em risco: desfalque importante", en: "at risk: key absence" },
};

/** "abriu @1,87 → agora @1,78": the price the book opened at, when the line itself has not moved. */
export function Movement({ leg, lang }: { leg: Pick<BetLeg, "openOdds" | "oddsDecimal">; lang: Lang }) {
  if (!leg.openOdds || !Number.isFinite(leg.oddsDecimal) || Math.abs(leg.openOdds - leg.oddsDecimal) < 0.01) return null;
  const shorter = leg.oddsDecimal < leg.openOdds;
  const fmt = (n: number) => formatNumber(n, lang, { digits: 2 });
  return (
    <span className="nums text-micro text-fg-dim" data-testid="leg-movement" title={lang === "pt" ? (shorter ? "A odd caiu desde a abertura: o mercado foi nessa direção" : "A odd subiu desde a abertura: o mercado foi contra") : shorter ? "The price shortened since the open: the market moved this way" : "The price drifted since the open: the market moved against it"}>
      {lang === "pt" ? "abriu" : "opened"} @{fmt(leg.openOdds)} <span className={shorter ? "text-pos" : "text-warn"}>{shorter ? "↘" : "↗"}</span> {lang === "pt" ? "agora" : "now"} @{fmt(leg.oddsDecimal)}
    </span>
  );
}

/** For long tickets: the expected losers out of 100 identical tickets, from the modelled chance. */
export function expectedLosers(modelledProbability: number): number {
  return Math.round(100 * (1 - Math.min(Math.max(modelledProbability, 0), 1)));
}

/** EV is a measurement, not a result: it is set like every other number and carries its own sign.
 *  Red belongs to a settled loss (§6.2); a negative edge is said by the minus and by the risk line. */
function EdgeTag({ edgePct, lang }: { edgePct: number | undefined; lang: Lang }) {
  if (edgePct === undefined || !Number.isFinite(edgePct))
    return (
      <span className="nums text-micro text-fg-dim" title="Alguma linha está sem preço confirmado, então o retorno da múltipla não é calculável">
        EV —
      </span>
    );
  return (
    <span
      className="nums text-micro text-fg-muted"
      title={edgePct > 0 ? "Modelled probability beats the price" : "Price is worse than the modelled chance"}
    >
      EV {pctOf(edgePct / 100, lang, { signed: true })}
    </span>
  );
}

export function TicketDetails({ open, onClose, bet, lang, gameId, sportKey, alerts = [], alternatives = [], prices = null, booksRead = 0 }: {
  open: boolean;
  onClose: () => void;
  bet: BetSuggestion;
  lang: Lang;
  gameId?: string;
  sportKey?: string;
  alerts?: LegAlertView[];
  alternatives?: BetSuggestion[];
  prices?: TicketPricesView | null;
  booksRead?: number;
}) {
  const t = makeT(lang);
  const band = getBand(bet.bandKey);
  const longshot = bet.combinedDecimal >= 20;

  return (
    <Modal open={open} onClose={onClose} title={bet.title} closeLabel={t("ticketCloseDetails")} testId="ticket-details">
      <div className="flex flex-col gap-3 text-fg-muted">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Chip tone={bet.confidence}>{bet.kind === "parlay" ? t("parlay") : t("single")}</Chip>
          <span title={bet.evidenceNotes.join(" · ")}>
            <Badge tone={bet.evidenceScore >= 70 ? "neutral" : bet.evidenceScore >= 45 ? "warn" : "neg"}>
              {lang === "pt" ? "confiança" : "confidence"} {bet.evidenceScore}
            </Badge>
          </span>
          <Badge>{band.label[lang]}</Badge>
          <span className="ml-auto flex items-center gap-2">
            <EdgeTag edgePct={bet.edgePct} lang={lang} />
            {/* Never the multiplier alone: the primitive refuses to render half the pair (§11.4). */}
            <Odds decimal={bet.combinedDecimal} probability={bet.modelledProbability} lang={lang} className="text-sm" />
          </span>
        </div>

        <div>
          <h4 className="text-micro u-label text-fg-dim">{t("background")}</h4>
          <p className="mt-1 text-tiny leading-relaxed text-fg-muted">{bet.background}</p>
        </div>

        <ol className="flex flex-col border-t border-line" data-testid="ticket-detail-lines">
          {bet.legs.map((leg, i) => (
            <li key={i} className="border-b border-line py-2.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="nums text-micro text-fg-dim">{i + 1}</span>
                {leg.athleteId && sportKey ? (
                  <Link href={{ pathname: `/app/player/${leg.athleteId}`, query: { sport: sportKey, lang, ...(gameId ? { game: gameId } : {}) } }} className="text-tiny font-medium text-fg underline decoration-line-control underline-offset-2 hover:decoration-fg max-md:inline-flex max-md:min-h-11 max-md:items-center" data-testid="leg-player-link">
                    {leg.selection}
                  </Link>
                ) : (
                  <span className="text-tiny font-medium text-fg">{leg.selection}</span>
                )}
                <span className="nums text-tiny text-fg-muted">{Number.isFinite(leg.oddsDecimal) ? formatOdds(leg.oddsDecimal, lang) : leg.odds}</span>
                {leg.book && <span className="text-micro text-fg-dim">{leg.book}</span>}
                {alerts.filter((a) => a.legIndex === i).map((a) => (
                  <span key={a.kind} className="rounded-control bg-neg-tint px-1.5 py-0.5 text-micro font-semibold text-neg" data-testid="leg-alert">{ALERT_LABEL[a.kind][lang]}</span>
                ))}
                <span className="nums ml-auto text-micro text-fg-dim">
                  {pctOf(leg.fairProbability, lang, { digits: 0 })}
                </span>
              </div>
              {prices?.legs[i] && <div className="mt-1"><LegPrices leg={prices.legs[i]} lang={lang} ctx={{ gameId, ticketId: bet.id, legIndex: i }} /></div>}
              {(leg.measured || leg.openOdds) && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {leg.measured && (
                    <span className="nums text-micro text-fg-dim" data-testid="leg-measured">
                      {lang === "pt" ? "nessa linha" : "at this line"}: L5 {leg.measured.last5} · L10 {leg.measured.last10} · {lang === "pt" ? "temp" : "season"} {leg.measured.season}
                    </span>
                  )}
                  <Movement leg={leg} lang={lang} />
                </div>
              )}
              <p className="mt-1 text-tiny leading-relaxed text-fg-muted">{leg.explanation}</p>
              <p className="mt-1 border-l-2 border-focus pl-2 text-tiny leading-relaxed text-fg-dim">
                <span className="font-medium text-fg-muted">{t("evidence")}: </span>
                {leg.evidence}
              </p>
            </li>
          ))}
        </ol>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-line pb-2.5 sm:grid-cols-4" data-testid="ticket-numbers">
          {[
            [t("combined"), formatDecimal(bet.combinedDecimal, lang)],
            [t("impliedChance"), pctOf(bet.impliedProbability, lang, { digits: 2 })],
            [t("modelledChance"), pctOf(bet.modelledProbability, lang, { digits: 2 })],
            [t("evLabel"), Number.isFinite(bet.edgePct) ? pctOf(bet.edgePct / 100, lang, { signed: true }) : "—"],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1">
              <span className="text-micro u-label text-fg-dim">{label}</span>
              <span className="nums text-sm text-fg">{value}</span>
            </div>
          ))}
        </div>

        {bet.evidenceNotes.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
            {bet.evidenceNotes.map((note, i) => (
              <li key={i} className="text-label text-fg-dim">
                · {note}
              </li>
            ))}
          </ul>
        )}
        {/* The discount the legs of one game apply to each other: on the face it was a number with
            no room to say what it meant, and here it has the sentence the model wrote for it. */}
        {bet.correlation?.note && (
          <p className="text-tiny leading-relaxed text-fg-dim" data-testid="ticket-correlation">
            <span className="font-medium text-fg-muted">{t("correlationLabel")}: </span>
            {bet.correlation.note}
          </p>
        )}
        <p className="border-l-2 border-warn pl-2.5 text-tiny leading-relaxed text-warn">
          <span className="font-medium">{t("risk")}: </span>
          {bet.riskNote}
        </p>
        {longshot && (
          <p className="text-label leading-relaxed text-fg-dim">
            {band.label[lang]} · {pctOf(bet.impliedProbability, lang, { digits: 2 })} — {t("longshotWarning")}
          </p>
        )}
        {bet.combinedDecimal >= 50 && (
          <p className="text-tiny font-medium leading-relaxed text-warn" data-testid="expected-losers">
            {lang === "pt"
              ? `Chance real ${pctOf(bet.modelledProbability, lang, { digits: 2 })}: em 100 bilhetes assim, espere perder ~${expectedLosers(bet.modelledProbability)}.`
              : `Real chance ${pctOf(bet.modelledProbability, lang, { digits: 2 })}: out of 100 tickets like this, expect to lose ~${expectedLosers(bet.modelledProbability)}.`}
          </p>
        )}
        {prices && <TicketPrices ticket={prices} lang={lang} ctx={{ gameId, ticketId: bet.id }} legNames={bet.legs.map((l) => l.selection)} booksRead={booksRead} />}
        {alternatives.length > 0 && <Alternatives main={bet} alternatives={alternatives} lang={lang} gameId={gameId} sportKey={sportKey} flagged={alerts} />}
      </div>
    </Modal>
  );
}

/**
 * Plan B under a ticket: each alternative shows what it swaps (struck-through vs new legs), how the
 * price and the chance move, and when to switch. An alternative that avoids a flagged player is marked.
 */
function Alternatives({ main, alternatives, lang, flagged }: { main: BetSuggestion; alternatives: BetSuggestion[]; lang: Lang; gameId?: string; sportKey?: string; flagged: LegAlertView[] }) {
  const flaggedPlayers = new Set(flagged.map((f) => f.player.toLowerCase()));
  const avoids = (alt: BetSuggestion) => flaggedPlayers.size > 0 && alt.legs.every((l) => !l.settlement?.player || !flaggedPlayers.has(l.settlement.player.toLowerCase()));
  const pct = (n: number) => `${formatNumber(n * 100, lang, { digits: 1, signed: true })} pp`;
  return (
    <details className="group rounded-control border border-line-strong bg-surface-1" data-testid="alternatives" open={flaggedPlayers.size > 0} onToggle={(e) => { if (e.currentTarget.open) track("alt_expanded", { count: alternatives.length }); }}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-tiny font-medium text-fg">
        <span className="text-fg-dim transition-transform duration-(--dur-1) ease-(--ease-out) group-open:rotate-90">›</span>
        {alternatives.length === 1 ? (lang === "pt" ? "1 alternativa" : "1 alternative") : lang === "pt" ? `${alternatives.length} alternativas` : `${alternatives.length} alternatives`}
        <span className="text-fg-dim">· {lang === "pt" ? "se essa cair, vai de…" : "if this one breaks, go with…"}</span>
      </summary>
      <ul className="flex flex-col gap-2 px-3 pb-3">
        {alternatives.map((alt) => {
          const diff = legDiff(main, alt);
          const highlight = avoids(alt);
          return (
            <li key={alt.id} className={cx("rounded-control border p-2.5", highlight ? "border-line-strong bg-surface-2" : "border-line bg-surface-1")} data-testid="alternative">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-tiny font-semibold text-fg">{alt.title}</span>
                {highlight && <span className="rounded-control bg-action px-1.5 py-0.5 text-micro font-semibold text-pos" data-testid="alt-avoids">{lang === "pt" ? "alternativa sem ele" : "backup without him"}</span>}
                <span className="nums ml-auto text-tiny text-fg">{formatDecimal(alt.combinedDecimal, lang)}</span>
              </div>
              {alt.swapReason && <p className="mt-1 text-tiny text-fg-muted">{lang === "pt" ? "Quando trocar" : "When to switch"}: {alt.swapReason}</p>}
              <ul className="mt-1.5 flex flex-col gap-0.5 text-tiny" data-testid="alt-diff">
                {diff.removed.map((sel) => <li key={`r-${sel}`} className="text-fg-dim line-through decoration-neg">− {sel}</li>)}
                {diff.added.map((sel) => <li key={`a-${sel}`} className="text-pos">+ {sel}</li>)}
                {diff.kept.map((sel) => <li key={`k-${sel}`} className="text-fg-muted">= {sel}</li>)}
              </ul>
              <p className="nums mt-1.5 text-label text-fg-dim">
                {lang === "pt" ? "preço" : "price"} {formatDecimal(main.combinedDecimal, lang)} → {formatDecimal(alt.combinedDecimal, lang)} · {lang === "pt" ? "chance estimada" : "modelled chance"} {pct(alt.modelledProbability - main.modelledProbability)}
              </p>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
