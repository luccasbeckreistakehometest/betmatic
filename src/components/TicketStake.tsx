"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, buttonClass, chipClass } from "@/components/ui";
import { formatMoney, formatNumber, formatStakeUnits } from "@/lib/format";
import { kellyFraction } from "@/lib/odds";
import { makeT, type Lang } from "@/lib/i18n";
import type { BetSuggestion } from "@/lib/types";

/**
 * "Adicionar à banca", as a betting slip asks it: how much, in the unit the reader thinks in, and
 * what it pays back if every line lands.
 *
 * A unit is one per cent of the declared bankroll — the same arithmetic "Os bilhetes de hoje" uses,
 * so the two screens never disagree about what 1 u is worth. When the bankroll has never been
 * declared the product asks for it instead of inventing one: a unit with no bankroll behind it is a
 * number pretending to be an amount. The reader can answer right here, or stake in reais and move
 * on.
 *
 * Nothing about the amount lives only in the browser: the stake goes to /api/bankroll and the
 * bankroll to /api/settings, the two routes that already own those numbers, and both refuse what
 * the reader's own ceilings and self-exclusion refuse.
 */

type Mode = "units" | "money";
type Saved = "idle" | "saving" | "saved" | "error" | "limit" | "paused";

const parse = (value: string) => Number(value.replace(",", ".").trim());
/** The stake in reais a number of units buys, rounded down to the fifty cents a book accepts. */
const moneyOf = (units: number, bankroll: number) => Math.floor((units * 0.01 * bankroll) / 0.5) * 0.5;

export function TicketStake({ bet, lang, gameId, onSaved }: { bet: BetSuggestion; lang: Lang; gameId: string; onSaved?: () => void }) {
  const t = makeT(lang);
  // Quarter Kelly from the ticket's own modelled probability: the size a disciplined bettor would
  // put on it. It used to sit on the face of the card as a sentence; here it is the field's default.
  const kellyUnits = kellyFraction(bet.combinedDecimal, bet.modelledProbability) * 100;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("units");
  const [amount, setAmount] = useState("");
  /** undefined while the server has not answered yet; null when the reader never declared one. */
  const [bankroll, setBankroll] = useState<number | null | undefined>(undefined);
  const [declared, setDeclared] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved>("idle");
  const [limitNote, setLimitNote] = useState("");
  const field = useRef<HTMLInputElement>(null);

  // The bankroll is read when the entry opens, never on page load: a screen of tickets would
  // otherwise ask the same question once per card.
  useEffect(() => {
    if (!open || bankroll !== undefined) return;
    let alive = true;
    void fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((body: { settings?: { bankrollAmount: number | null } } | null) => {
        if (alive) setBankroll(body?.settings?.bankrollAmount ?? null);
      });
    return () => { alive = false; };
  }, [open, bankroll]);

  function start() {
    setOpen(true);
    setSaved("idle");
    if (!amount && kellyUnits > 0) setAmount(formatNumber(kellyUnits, lang, { digits: 2 }));
    // The field is the point of the button: land in it.
    setTimeout(() => field.current?.focus(), 0);
  }

  function switchTo(next: Mode) {
    if (next === mode) return;
    setMode(next);
    // A number typed as units is not the same number in reais. Rather than convert behind the
    // reader's back, the field starts again — except for the one default the product owns.
    setAmount(next === "units" && kellyUnits > 0 ? formatNumber(kellyUnits, lang, { digits: 2 }) : "");
    setSaved("idle");
  }

  const typed = parse(amount);
  const units = mode === "units" && typed > 0 ? typed : 0;
  // What will actually be staked, in reais. In units it needs a bankroll to exist at all.
  const stake = mode === "money" ? (typed > 0 ? typed : 0) : bankroll ? moneyOf(units, bankroll) : 0;
  const ready = stake > 0;
  const askBankroll = mode === "units" && bankroll === null;

  async function save() {
    if (!ready) return;
    setSaving(true);
    setSaved("idle");
    const response = await fetch("/api/bankroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "ticket", gameId, bandKey: bet.bandKey, selections: bet.legs.map((l) => l.selection), stake }),
    }).catch(() => null);
    setSaving(false);
    if (response?.status === 422) {
      const body = await response.json().catch(() => ({}));
      const left = body.reason === "weekly" ? body.remainingWeekly : body.remainingDaily;
      setLimitNote((body.reason === "weekly" ? t("limitWeekly") : t("limitDaily")).replace("{left}", formatMoney(Number(left ?? 0), lang)));
      setSaved("limit");
      return;
    }
    if (response?.status === 423) { setSaved("paused"); return; }
    if (!response?.ok) { setSaved("error"); return; }
    setSaved("saved");
    setOpen(false);
    onSaved?.();
  }

  async function saveBankroll() {
    const value = parse(declared);
    if (!(value > 0)) return;
    setSaving(true);
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankrollAmount: value }),
    }).catch(() => null);
    setSaving(false);
    if (!response?.ok) { setSaved("error"); return; }
    const body = await response.json().catch(() => null);
    setBankroll(body?.settings?.bankrollAmount ?? value);
  }

  if (saved === "saved") return <span className="text-tiny text-pos" data-testid="ticket-saved">✓ {t("saved")}</span>;

  if (!open) {
    return (
      <Button icon="wallet" onClick={start} data-testid="ticket-add-open" className="max-md:w-full">
        {t("addToBankroll")}
      </Button>
    );
  }

  const unitMoney = bankroll && units > 0 ? moneyOf(units, bankroll) : 0;
  return (
    <div className="flex w-full flex-col gap-2" data-testid="ticket-stake-entry">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="group" aria-label={t("stakeHowMuch")}>
          {(["units", "money"] as Mode[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={mode === key}
              onClick={() => switchTo(key)}
              className={chipClass(mode === key)}
              data-testid={`ticket-stake-${key}`}
            >
              {t(key === "units" ? "stakeInUnits" : "stakeInMoney")}
            </button>
          ))}
        </div>
        {/* min-w-0: as a flex item the field would otherwise refuse to be narrower than its default
            twenty characters and set the width of the card. */}
        <input
          ref={field}
          aria-label={t("stakeHowMuch")}
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setSaved("idle"); }}
          onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
          placeholder={mode === "units" ? "1,00" : "10,00"}
          inputMode="decimal"
          enterKeyHint="done"
          size={6}
          data-testid="ticket-stake"
          className={buttonClass("secondary", "w-24 nums text-right placeholder:font-sans placeholder:tracking-normal max-md:w-auto max-md:min-w-0 max-md:flex-1")}
        />
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={!ready}
          loading={saving && !askBankroll}
          data-testid="ticket-add"
        >
          {t("addToBankroll")}
        </Button>
        <Button variant="ghost" onClick={() => { setOpen(false); setSaved("idle"); }} data-testid="ticket-stake-cancel">
          {t("cancel")}
        </Button>
      </div>

      {/* What the amount is worth and what it pays back, recomputed as the reader types. */}
      <p className="flex flex-wrap items-baseline gap-x-2 text-tiny text-fg-dim" data-testid="ticket-return">
        {mode === "units" && (
          <span className="nums">
            {formatStakeUnits(units, lang)}
            {unitMoney > 0 ? ` = ${formatMoney(unitMoney, lang)}` : ""}
          </span>
        )}
        <span>
          {t("potentialReturn")}:{" "}
          <span className="nums text-fg">{ready ? formatMoney(stake * bet.combinedDecimal, lang) : "—"}</span>
        </span>
        <span className="text-fg-dim">· {t("potentialReturnHint")}</span>
      </p>
      {mode === "units" && (
        <p className="text-micro text-fg-dim">
          {t("stakeUnitWorth")}
          {kellyUnits > 0 && <> · {formatStakeUnits(kellyUnits, lang)} (¼ Kelly)</>}
        </p>
      )}

      {/* No bankroll on file: ask for it instead of pricing a unit at a number nobody chose. */}
      {askBankroll && (
        <div className="flex flex-col gap-1.5 border-l-2 border-warn pl-2.5" data-testid="ticket-bankroll-ask">
          <p className="text-tiny leading-relaxed text-warn">{t("bankrollUndeclared")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label={t("bankrollAsk")}
              value={declared}
              onChange={(e) => setDeclared(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void saveBankroll(); }}
              placeholder="1.000,00"
              inputMode="decimal"
              enterKeyHint="done"
              size={8}
              data-testid="ticket-bankroll-amount"
              className={buttonClass("secondary", "w-28 nums text-right placeholder:font-sans placeholder:tracking-normal max-md:w-auto max-md:min-w-0 max-md:flex-1")}
            />
            <Button onClick={() => void saveBankroll()} disabled={!(parse(declared) > 0)} loading={saving} data-testid="ticket-bankroll-save">
              {t("bankrollSave")}
            </Button>
            <Link href={{ pathname: "/app/settings", query: { lang } }} className="text-tiny text-fg-dim underline underline-offset-2 max-md:inline-flex max-md:min-h-11 max-md:items-center">
              {t("todaySetBankroll")}
            </Link>
          </div>
        </div>
      )}

      {saved === "limit" && <p className="text-tiny text-warn" data-testid="ticket-limit">{limitNote}</p>}
      {saved === "paused" && <p className="text-tiny text-warn" data-testid="ticket-paused">{t("pausedHint")}</p>}
      {saved === "error" && <p className="text-tiny text-warn" data-testid="ticket-stake-error">{t("bankrollSignIn")}</p>}
    </div>
  );
}
