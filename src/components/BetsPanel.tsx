"use client";

import { track } from "@/lib/track";
import { useState } from "react";
import Link from "next/link";

import { Badge, Chip, Empty, Odds, Skeleton, buttonClass, chipClass, cx, useIsPhone } from "@/components/ui";
import { formatMoney, formatNumber, formatPercent as pctOf } from "@/lib/format";
import { groupAlternatives, legDiff } from "@/lib/bets/alternatives-view";
import { kellyFraction, formatDecimal, getBand } from "@/lib/odds";
import { makeT, type Lang } from "@/lib/i18n";
import type { BetLeg, BetSlate, BetSuggestion } from "@/lib/types";
import { LegPrices, PricesMeta, PropSignalsList, TicketPrices, type TicketPricesView } from "@/components/PriceComparison";
import type { PropSignal } from "@/lib/sources/br-books/compare";

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
      <span className="nums text-micro text-fg-dim" title="Alguma perna está sem preço confirmado, então o retorno da múltipla não é calculável">
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

function Ticket({ bet, lang, gameId, sportKey, alerts = [], alternatives = [], prices = null, booksRead = 0, className = "" }: { bet: BetSuggestion; lang: Lang; gameId?: string; sportKey?: string; alerts?: LegAlertView[]; alternatives?: BetSuggestion[]; prices?: TicketPricesView | null; booksRead?: number; className?: string }) {
  const t = makeT(lang);
  const band = getBand(bet.bandKey);
  const longshot = bet.combinedDecimal >= 20;
  // Quarter Kelly from the ticket's own modelled probability: the stake a disciplined bettor would size.
  const kelly = kellyFraction(bet.combinedDecimal, bet.modelledProbability);
  const [stake, setStake] = useState("");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error" | "limit" | "paused">("idle");
  const [limitNote, setLimitNote] = useState("");
  async function addToBankroll() {
    if (!gameId) return;
    setSaved("saving");
    const r = await fetch("/api/bankroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "ticket", gameId, bandKey: bet.bandKey, selections: bet.legs.map((l) => l.selection), stake: Number(stake) }) });
    if (r.status === 422) {
      const j = await r.json().catch(() => ({}));
      const left = j.reason === "weekly" ? j.remainingWeekly : j.remainingDaily;
      setLimitNote((j.reason === "weekly" ? t("limitWeekly") : t("limitDaily")).replace("{left}", formatMoney(Number(left ?? 0), lang)));
      setSaved("limit");
      return;
    }
    setSaved(r.status === 423 ? "paused" : r.ok ? "saved" : "error");
  }

  return (
    <li className={cx("rounded-panel border border-line bg-surface-1", className)} data-testid="ticket" data-band={bet.bandKey}>
      {/* On a phone the title takes the first line by itself and the facts sit under it; on a desk
          the row reads chip · title · confidence · price in one line, as before. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line px-3.5 py-2.5">
        <Chip tone={bet.confidence}>{bet.kind === "parlay" ? t("parlay") : t("single")}</Chip>
        <span className="text-sm font-semibold text-fg max-md:order-first max-md:basis-full max-md:text-base">{bet.title}</span>
        <span title={bet.evidenceNotes.join(" · ")}>
          <Badge tone={bet.evidenceScore >= 70 ? "neutral" : bet.evidenceScore >= 45 ? "warn" : "neg"}>
            {lang === "pt" ? "confiança" : "confidence"} {bet.evidenceScore}
          </Badge>
        </span>
        <span className="ml-auto flex items-center gap-2">
          <EdgeTag edgePct={bet.edgePct} lang={lang} />
          {/* Never the multiplier alone: the primitive refuses to render half the pair (§11.4). */}
          <Odds decimal={bet.combinedDecimal} probability={bet.modelledProbability} lang={lang} className="text-sm" />
        </span>
      </div>

      <div className="px-3.5 py-3">
        <div>
          <h4 className="text-micro u-label text-fg-dim">{t("background")}</h4>
          <p className="mt-1 text-tiny leading-relaxed text-fg-muted">{bet.background}</p>
        </div>

        <ol className="mt-3 flex flex-col border-t border-line">
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
                <span className="nums text-tiny text-fg-muted">{leg.odds}</span>
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

        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-line py-2.5 sm:grid-cols-4">
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
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
            {bet.evidenceNotes.map((note, i) => (
              <li key={i} className="text-label text-fg-dim">
                · {note}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2.5 border-l-2 border-warn pl-2.5 text-tiny leading-relaxed text-warn">
          <span className="font-medium">{t("risk")}: </span>
          {bet.riskNote}
        </p>
        {longshot && (
          <p className="mt-1.5 text-label leading-relaxed text-fg-dim">
            {band.label[lang]} · {pctOf(bet.impliedProbability, lang, { digits: 2 })} — {t("longshotWarning")}
          </p>
        )}
        {bet.combinedDecimal >= 50 && (
          <p className="mt-1.5 text-tiny font-medium leading-relaxed text-warn" data-testid="expected-losers">
            {lang === "pt"
              ? `Chance real ${pctOf(bet.modelledProbability, lang, { digits: 2 })}: em 100 bilhetes assim, espere perder ~${expectedLosers(bet.modelledProbability)}.`
              : `Real chance ${pctOf(bet.modelledProbability, lang, { digits: 2 })}: out of 100 tickets like this, expect to lose ~${expectedLosers(bet.modelledProbability)}.`}
          </p>
        )}
        {prices && <TicketPrices ticket={prices} lang={lang} ctx={{ gameId, ticketId: bet.id }} legNames={bet.legs.map((l) => l.selection)} booksRead={booksRead} />}
        {alternatives.length > 0 && <Alternatives main={bet} alternatives={alternatives} lang={lang} gameId={gameId} sportKey={sportKey} flagged={alerts} />}
      </div>
      {(kelly > 0 || gameId) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-3.5 py-2.5 text-tiny" data-testid="ticket-bankroll">
          {kelly > 0 && <span className="text-fg-muted">{lang === "pt" ? "stake sugerido" : "suggested stake"}: <span className="nums text-fg">{pctOf(kelly, lang)}</span> {lang === "pt" ? "da banca" : "of bankroll"} <span className="text-fg-dim">(¼ Kelly)</span></span>}
          {/* min-w-0: as a flex item this span would otherwise refuse to be narrower than the
              field's default 20 characters plus the button, and set the width of the page. */}
          {gameId && (
            <span className="ml-auto flex items-center gap-2 max-md:ml-0 max-md:min-w-0 max-md:basis-full">
              {saved === "saved" ? <span className="text-pos">✓ {t("saved")}</span> : saved === "error" ? <span className="text-warn">{lang === "pt" ? "entre para salvar" : "sign in to save"}</span> : saved === "limit" ? <span className="text-warn" data-testid="ticket-limit">{limitNote}</span> : saved === "paused" ? <span className="text-warn" data-testid="ticket-paused">{t("pausedHint")}</span> : (
                <>
                  {/* The stake is money: the decimal keypad, and on a phone the field and the button share the line. */}
                  <input aria-label={lang === "pt" ? "Valor apostado (R$)" : "Stake (R$)"} value={stake} onChange={(e) => setStake(e.target.value)} placeholder={t("stake")} inputMode="decimal" enterKeyHint="done" size={6} className={buttonClass("secondary", "w-20 nums placeholder:font-sans placeholder:tracking-normal max-md:w-auto max-md:min-w-0 max-md:flex-1 max-md:text-right")} data-testid="ticket-stake" />
                  <button onClick={addToBankroll} disabled={!(Number(stake) > 0) || saved === "saving"} className={buttonClass("secondary", "max-md:flex-1")} data-testid="ticket-add">{t("addToBankroll")}</button>
                </>
              )}
            </span>
          )}
        </div>
      )}
    </li>
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
    <details className="group mt-3 rounded-control border border-line-strong bg-surface-1" data-testid="alternatives" open={flaggedPlayers.size > 0} onToggle={(e) => { if (e.currentTarget.open) track("alt_expanded", { count: alternatives.length }); }}>
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
            <li key={alt.id} className={`rounded-control border p-2.5 ${highlight ? "border-line-strong bg-surface-2" : "border-line bg-surface-1"}`} data-testid="alternative">
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

/** Two ticket cards in the final shape — header, legs, the figures — while the real ones arrive. */
export function TicketSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3" data-testid="tickets-loading">
      <span className="sr-only">{label}</span>
      {[0, 1].map((i) => (
        <div key={i} aria-hidden="true" className="rounded-panel border border-line bg-surface-1">
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">
            <Skeleton width="3.5rem" />
            <Skeleton width={i ? "9rem" : "11rem"} className="h-4" />
            <Skeleton width="5rem" className="ml-auto" />
          </div>
          <div className="flex flex-col gap-3 px-3.5 py-3">
            <Skeleton width="100%" />
            <Skeleton width="86%" />
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              {[0, 1, 2].map((leg) => (
                <div key={leg} className="flex items-center gap-2 py-1.5 u-rule last:shadow-none">
                  <Skeleton width="1rem" />
                  <Skeleton width={`${40 + ((leg * 19) % 30)}%`} className="h-3.5" />
                  <Skeleton width="2.5rem" className="ml-auto" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 border-y border-line py-2.5 sm:grid-cols-4">
              {[0, 1, 2, 3].map((k) => (
                <div key={k} className="flex flex-col gap-1.5">
                  <Skeleton width="4rem" className="h-2.5" />
                  <Skeleton width="3rem" className="h-3.5" />
                </div>
              ))}
            </div>
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
