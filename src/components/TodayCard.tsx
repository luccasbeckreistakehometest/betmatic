"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, LinkButton, Odds, buttonClass, cx } from "@/components/ui";
import { formatMoney, formatOdds, formatPercent, formatStakeUnits } from "@/lib/format";
import { formatDecimal } from "@/lib/odds";
import { makeT, type Lang } from "@/lib/i18n";
import type { TodayItem } from "@/app/api/today/route";

/**
 * One card of the day's short list. Four things, and only four: **the ticket, the unit, the chance,
 * the next step.** Everything the product already shows about a ticket — every leg with its
 * evidence, the measured record, the correlation, the band, the EV, the alternatives — is still
 * here and is one tap away, inside `por que este`. Nothing was removed; it was moved off the face.
 */

/**
 * Renders an i18n sentence with its numbers set in mono. The sentence stays one translated string
 * (the compliance test reads it whole) and the numerals still get tabular figures and the reader's
 * decimal mark, which a plain `.replace()` into a `<p>` cannot do.
 */
export function Filled({ text, values, emphasise, className = "" }: { text: string; values: Record<string, string>; emphasise?: string; className?: string }) {
  return (
    <>
      {text.split(/(\{[a-zA-Z]+\})/).map((part, i) => {
        const key = part.startsWith("{") && part.endsWith("}") ? part.slice(1, -1) : null;
        if (!key || values[key] === undefined) return <span key={i}>{part}</span>;
        return (
          <span key={i} className={cx("nums", key === emphasise ? "text-h3 leading-none text-fg" : className)}>
            {values[key]}
          </span>
        );
      })}
    </>
  );
}

/** Seconds left on a live read, recomputed every second; 0 means the card has expired. */
function useCountdown(expiresAt: string | undefined): number {
  const [left, setLeft] = useState(() => (expiresAt ? Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000)) : 0));
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setLeft(Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return left;
}

export interface TodayCardProps {
  item: TodayItem;
  lang: Lang;
  bankroll: number | null;
  smallBankroll: boolean;
  sportKey: string;
  day: string;
  onSaved: () => void;
}

export function TodayCard({ item, lang, bankroll, smallBankroll, sportKey, day, onSaved }: TodayCardProps) {
  const t = makeT(lang);
  const live = item.scope === "live";
  const secondsLeft = useCountdown(item.expiresAt);
  const expired = live && !!item.expiresAt && secondsLeft <= 0;
  const [price, setPrice] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">(item.saved ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);

  const confirmed = Number(price.replace(",", "."));
  const confirmedOk = Number.isFinite(confirmed) && confirmed > 1;
  // A live read is a reference price until the reader says what they got; only then is it a bet.
  const units = live ? (confirmedOk ? item.units || 0.25 : 0) : item.units;
  const money = bankroll ? formatMoney(Math.floor((units * 0.01 * bankroll) / 0.5) * 0.5, lang) : null;

  async function register() {
    setState("saving");
    setError(null);
    const stake = bankroll ? Math.floor((units * 0.01 * bankroll) / 0.5) * 0.5 : units;
    const response = await fetch("/api/today", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledgerId: item.ledgerId, stake: Math.max(stake, 0.5), sport: sportKey, day, lang, ...(live ? { confirmedDecimal: confirmed } : {}) }),
    }).catch(() => null);
    if (!response?.ok) {
      setState("error");
      setError(response?.status === 422 ? t("todayStakeRefused") : t("networkError"));
      return;
    }
    setState("done");
    onSaved();
  }

  return (
    <article data-testid="today-card" data-scope={item.scope} className={cx("rounded-panel border bg-surface-1", expired ? "border-line opacity-60" : "border-line")}>
      <div className="flex flex-col gap-3 p-(--panel-p)">
        {live && (
          <p className="text-label u-label text-warn" data-testid="today-live-timer">
            <Filled text={t("todayLive")} values={{ s: String(secondsLeft) }} />
          </p>
        )}

        <div className="flex flex-col gap-1">
          <h3 className="text-sm leading-snug font-medium text-fg">{item.title}</h3>
          <p className="flex flex-wrap items-baseline gap-x-2 text-tiny text-fg-dim">
            <Odds decimal={item.decimal} probability={item.impliedProbability} lang={lang} />
            {item.book && <span>{lang === "pt" ? `na ${item.book}` : `at ${item.book}`}</span>}
            <span className="truncate">{item.matchup}</span>
          </p>
        </div>

        {live ? (
          <p className="text-sm text-fg-muted">
            <Filled text={t("todayLiveReference")} values={{ d: formatOdds(item.decimal, lang) }} className="text-fg" />
          </p>
        ) : item.units <= 0 ? (
          /* An observation. It keeps its chance and its minimum price — everything except a stake,
             because the one number it must not show is a size nobody should bet. */
          <p data-testid="today-stake" className="flex flex-wrap items-baseline gap-x-2 border-t border-line pt-3 text-sm text-fg-muted">
            <span className="text-fg">{t("todayNoStake")}</span>
            <span className="text-tiny text-fg-dim">{item.noStakeReason === "day_cap" ? t("todayNoStakeCap") : t("todayNoStakeWhy")}</span>
          </p>
        ) : (
          <p data-testid="today-stake" className="flex flex-wrap items-baseline gap-x-2 border-t border-line pt-3 text-sm text-fg-muted">
            <Filled
              text={money ? t("todayStake") : t("todayStakeNoMoney")}
              values={{ u: formatStakeUnits(units, lang), pct: formatPercent(units * 0.01, lang, { digits: 2 }), money: money ?? "" }}
              emphasise="u"
              className="text-fg"
            />
          </p>
        )}

        <p className="text-sm text-fg-muted">
          <Filled
            text={t("todayChance")}
            values={{ p: formatPercent(item.calibratedProbability, lang, { digits: 0 }), implied: formatPercent(item.impliedProbability, lang, { digits: 0 }) }}
            className="text-fg"
          />
        </p>

        <p className="text-tiny text-fg-dim">
          <Filled
            text={live ? t("todayLiveMin") : t("todayMinOdds")}
            values={{ odd: formatOdds(item.minDecimal, lang) }}
          />{" "}
          {!live && t("todayCheckPrice")}
        </p>

        {!bankroll && !live && (
          <p className="text-tiny text-fg-dim">
            {t("todayNoBankroll")}{" "}
            <Link href={{ pathname: "/app/settings", query: { lang } }} className="underline underline-offset-2">{t("todaySetBankroll")}</Link>
          </p>
        )}
        {bankroll && smallBankroll && !live && <p className="text-tiny text-warn">{t("todaySmallBankroll")}</p>}

        {expired ? (
          <p className="text-sm text-fg-dim" data-testid="today-expired">{t("todayLiveExpired")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {live && (
              <label className="flex items-center gap-2 text-tiny text-fg-muted">
                <span>{t("todayLiveAsk")}</span>
                <input
                  aria-label={t("todayLiveAsk")}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  inputMode="decimal"
                  enterKeyHint="done"
                  size={5}
                  data-testid="today-live-price"
                  className={buttonClass("secondary", "w-20 nums placeholder:font-sans")}
                />
              </label>
            )}
            <LinkButton
              href={item.gameHref}
              variant="primary"
              data-testid="today-open"
            >
              {item.book ? t("todayOpenBook") : t("todayOpenGame")}
            </LinkButton>
            <Button
              onClick={register}
              disabled={state === "done" || (live && !confirmedOk)}
              loading={state === "saving"}
              data-testid="today-register"
            >
              {state === "done" ? t("todayRegistered") : t("todayRegister")}
            </Button>
          </div>
        )}
        {error && <p className="text-tiny text-neg">{error}</p>}
        {live && !confirmedOk && !expired && <p className="text-tiny text-fg-dim">{t("todayLiveUnverified")}</p>}

        <TicketWhy item={item} lang={lang} />
      </div>
    </article>
  );
}

/**
 * `por que este` — closed by default, and the home of everything the face does not show: the legs
 * with their evidence, the measured record behind each one, the correlation, the band, the EV, the
 * owner's own band rule as a sanity anchor, and the way to the full game page.
 */
function TicketWhy({ item, lang }: { item: TodayItem; lang: Lang }) {
  const t = makeT(lang);
  const d = item.detail;
  return (
    <details className="border-t border-line pt-2" data-testid="today-why">
      <summary className="u-ring-inset cursor-pointer text-tiny text-fg-muted marker:text-fg-dim">{t("todayWhy")}</summary>
      <div className="mt-2 flex flex-col gap-2 text-tiny text-fg-muted">
        {d.background && <p className="max-w-measure-app leading-relaxed">{d.background}</p>}
        <ul className="flex flex-col gap-1.5">
          {d.legs.map((leg, i) => (
            <li key={i} className="border-l-2 border-line pl-2">
              <span className="text-fg">{leg.selection}</span>{" "}
              <Odds decimal={leg.decimal} probability={leg.probability} lang={lang} className="ml-1" />
              {leg.evidence && <span className="block text-fg-dim">{leg.evidence}</span>}
              {leg.explanation && <span className="block text-fg-dim">{leg.explanation}</span>}
            </li>
          ))}
        </ul>
        {d.correlationNote && <p className="text-fg-dim">{d.correlationNote}</p>}
        {d.riskNote && <p className="text-fg-dim">{d.riskNote}</p>}
        {d.evidenceNotes.slice(0, 4).map((note, i) => <p key={i} className="text-fg-dim">{note}</p>)}
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-fg-dim">
          <span><dt className="inline">{t("evLabel")}</dt>{" "}<dd className="inline nums text-fg">{formatPercent(d.edgePct / 100, lang)}</dd></span>
          <span><dt className="inline">{lang === "pt" ? "evidência" : "evidence"}</dt>{" "}<dd className="inline nums text-fg">{d.evidenceScore}</dd></span>
          <span><dt className="inline">{lang === "pt" ? "faixa" : "band"}</dt>{" "}<dd className="inline text-fg">{item.bandKey}</dd></span>
          <span><dt className="inline">{lang === "pt" ? "combinada" : "combined"}</dt>{" "}<dd className="inline nums text-fg">{formatDecimal(item.decimal, lang)}</dd></span>
          {d.alternatives > 0 && (
            <span><dt className="inline">{lang === "pt" ? "alternativas" : "alternatives"}</dt>{" "}<dd className="inline nums text-fg">{d.alternatives}</dd></span>
          )}
        </dl>
        {/* The owner's hand-made ladder, kept beside the formula as a sanity anchor (§2f) — and only
            where there is a formula number to anchor. On an observation the wallet produced nothing,
            so printing the band's 1,25 u here would put the one thing this card must not carry back
            on the screen: a size to bet. The A/B arm is still filed on the row either way. */}
        {item.units > 0 && (
          <p className="text-fg-dim">
            <Filled text={t("todayLadder")} values={{ u: formatStakeUnits(item.ladderUnits, lang) }} />
            {item.capped !== "none" && <span> · {t("todayCapped")}</span>}
          </p>
        )}
        <Link href={item.gameHref} className="underline underline-offset-2">{t("todayAllTickets")}</Link>
      </div>
    </details>
  );
}
