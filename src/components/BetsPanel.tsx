"use client";

import { useState } from "react";
import Link from "next/link";

import { Chip, Empty } from "@/components/ui";
import { groupAlternatives, legDiff } from "@/lib/bets/alternatives-view";
import { kellyFraction, formatDecimal, formatPercent, getBand } from "@/lib/odds";
import { makeT, type Lang } from "@/lib/i18n";
import type { BetLeg, BetSlate, BetSuggestion } from "@/lib/types";

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
  const fmt = (n: number) => (lang === "pt" ? n.toFixed(2).replace(".", ",") : n.toFixed(2));
  return (
    <span className="nums text-[10.5px] text-mist-500" data-testid="leg-movement" title={lang === "pt" ? (shorter ? "A odd caiu desde a abertura: o mercado foi nessa direção" : "A odd subiu desde a abertura: o mercado foi contra") : shorter ? "The price shortened since the open: the market moved this way" : "The price drifted since the open: the market moved against it"}>
      {lang === "pt" ? "abriu" : "opened"} @{fmt(leg.openOdds)} <span className={shorter ? "text-edge-400" : "text-warn-400"}>{shorter ? "↘" : "↗"}</span> {lang === "pt" ? "agora" : "now"} @{fmt(leg.oddsDecimal)}
    </span>
  );
}

/** For long tickets: the expected losers out of 100 identical tickets, from the modelled chance. */
export function expectedLosers(modelledProbability: number): number {
  return Math.round(100 * (1 - Math.min(Math.max(modelledProbability, 0), 1)));
}

function EdgeTag({ edgePct }: { edgePct: number | undefined }) {
  if (edgePct === undefined || !Number.isFinite(edgePct))
    return (
      <span
        className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] font-medium text-mist-500"
        title="Alguma perna está sem preço confirmado, então o retorno da múltipla não é calculável"
      >
        EV n/d
      </span>
    );
  const positive = edgePct > 0;
  return (
    <span
      className={`nums rounded px-1.5 py-0.5 text-[10px] font-semibold ${
        positive ? "bg-edge-400/12 text-edge-400" : "bg-alert-400/10 text-alert-400"
      }`}
      title={positive ? "Modelled probability beats the price" : "Price is worse than the modelled chance"}
    >
      EV {positive ? "+" : ""}
      {edgePct.toFixed(1)}%
    </span>
  );
}

function Ticket({ bet, lang, gameId, sportKey, alerts = [], alternatives = [] }: { bet: BetSuggestion; lang: Lang; gameId?: string; sportKey?: string; alerts?: LegAlertView[]; alternatives?: BetSuggestion[] }) {
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
      setLimitNote((j.reason === "weekly" ? t("limitWeekly") : t("limitDaily")).replace("{left}", lang === "pt" ? `R$ ${Number(left ?? 0).toFixed(2)}` : `$${Number(left ?? 0).toFixed(2)}`));
      setSaved("limit");
      return;
    }
    setSaved(r.status === 423 ? "paused" : r.ok ? "saved" : "error");
  }

  return (
    <li className="rounded-xl border border-ink-800 bg-ink-850/50">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-800 px-3.5 py-2.5">
        <Chip tone={bet.confidence}>{bet.kind === "parlay" ? t("parlay") : t("single")}</Chip>
        <span className="text-[13px] font-semibold text-mist-100">{bet.title}</span>
        <span
          className={`nums rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            bet.evidenceScore >= 70
              ? "bg-edge-400/12 text-edge-400"
              : bet.evidenceScore >= 45
                ? "bg-warn-400/12 text-warn-400"
                : "bg-alert-400/12 text-alert-400"
          }`}
          title={bet.evidenceNotes.join(" · ")}
        >
          {lang === "pt" ? "confiança" : "confidence"} {bet.evidenceScore}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <EdgeTag edgePct={bet.edgePct} />
          <span className="nums rounded-lg bg-signal-500/12 px-2 py-0.5 text-[13px] font-bold text-signal-400">
            {formatDecimal(bet.combinedDecimal)}
          </span>
          <span className="nums text-[11px] text-mist-500">{bet.combinedAmerican}</span>
        </span>
      </div>

      <div className="px-3.5 py-3">
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-mist-500">{t("background")}</h4>
          <p className="mt-1 text-[12.5px] leading-relaxed text-mist-300">{bet.background}</p>
        </div>

        <ol className="mt-3 flex flex-col gap-2">
          {bet.legs.map((leg, i) => (
            <li key={i} className="rounded-lg border border-ink-800 bg-ink-900/60 p-2.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="nums text-[10px] text-mist-600">{i + 1}</span>
                {leg.athleteId && sportKey ? (
                  <Link href={{ pathname: `/app/player/${leg.athleteId}`, query: { sport: sportKey, lang, ...(gameId ? { game: gameId } : {}) } }} className="text-[12.5px] font-medium text-mist-100 underline decoration-ink-600 underline-offset-2 hover:decoration-edge-400" data-testid="leg-player-link">
                    {leg.selection}
                  </Link>
                ) : (
                  <span className="text-[12.5px] font-medium text-mist-100">{leg.selection}</span>
                )}
                <span className="nums text-[12px] text-mist-300">{leg.odds}</span>
                {leg.book && <span className="text-[10px] text-mist-500">{leg.book}</span>}
                {alerts.filter((a) => a.legIndex === i).map((a) => (
                  <span key={a.kind} className="rounded bg-alert-400/12 px-1.5 py-0.5 text-[10px] font-semibold text-alert-400" data-testid="leg-alert">{ALERT_LABEL[a.kind][lang]}</span>
                ))}
                <span className="nums ml-auto text-[10px] text-mist-500">
                  {formatPercent(leg.fairProbability, 0)}
                </span>
              </div>
              {(leg.measured || leg.openOdds) && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {leg.measured && (
                    <span className="nums text-[10.5px] text-mist-500" data-testid="leg-measured">
                      {lang === "pt" ? "nessa linha" : "at this line"}: L5 {leg.measured.last5} · L10 {leg.measured.last10} · {lang === "pt" ? "temp" : "season"} {leg.measured.season}
                    </span>
                  )}
                  <Movement leg={leg} lang={lang} />
                </div>
              )}
              <p className="mt-1 text-[12px] leading-relaxed text-mist-400">{leg.explanation}</p>
              <p className="mt-1 border-l-2 border-signal-500/30 pl-2 text-[11.5px] leading-relaxed text-mist-500">
                <span className="font-medium text-mist-400">{t("evidence")}: </span>
                {leg.evidence}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-ink-800 bg-ink-800 sm:grid-cols-4">
          {[
            [t("combined"), formatDecimal(bet.combinedDecimal)],
            [t("impliedChance"), formatPercent(bet.impliedProbability, 2)],
            [t("modelledChance"), formatPercent(bet.modelledProbability, 2)],
            [t("evLabel"), Number.isFinite(bet.edgePct) ? `${bet.edgePct > 0 ? "+" : ""}${bet.edgePct.toFixed(1)}%` : "—"],
          ].map(([label, value]) => (
            <div key={label} className="bg-ink-900 px-2 py-1.5 text-center">
              <div className="text-[9px] uppercase tracking-wider text-mist-500">{label}</div>
              <div className="nums text-[12px] text-mist-200">{value}</div>
            </div>
          ))}
        </div>

        {bet.evidenceNotes.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
            {bet.evidenceNotes.map((note, i) => (
              <li key={i} className="text-[11px] text-mist-500">
                · {note}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-warn-400/90">
          <span className="font-medium">{t("risk")}: </span>
          {bet.riskNote}
        </p>
        {longshot && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-mist-500">
            {band.label[lang]} · {formatPercent(bet.impliedProbability, 2)} — {t("longshotWarning")}
          </p>
        )}
        {bet.combinedDecimal >= 50 && (
          <p className="mt-1.5 text-[11.5px] font-medium leading-relaxed text-warn-400" data-testid="expected-losers">
            {lang === "pt"
              ? `Chance real ${formatPercent(bet.modelledProbability, 2)}: em 100 bilhetes assim, espere perder ~${expectedLosers(bet.modelledProbability)}.`
              : `Real chance ${formatPercent(bet.modelledProbability, 2)}: out of 100 tickets like this, expect to lose ~${expectedLosers(bet.modelledProbability)}.`}
          </p>
        )}
        {alternatives.length > 0 && <Alternatives main={bet} alternatives={alternatives} lang={lang} gameId={gameId} sportKey={sportKey} flagged={alerts} />}
      </div>
      {(kelly > 0 || gameId) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-ink-800 px-3.5 py-2.5 text-[12px]" data-testid="ticket-bankroll">
          {kelly > 0 && <span className="text-mist-400">{lang === "pt" ? "stake sugerido" : "suggested stake"}: <span className="nums text-mist-100">{(kelly * 100).toFixed(1)}%</span> {lang === "pt" ? "da banca" : "of bankroll"} <span className="text-mist-600">(¼ Kelly)</span></span>}
          {gameId && (
            <span className="ml-auto flex items-center gap-2">
              {saved === "saved" ? <span className="text-signal-400">✓ {t("saved")}</span> : saved === "error" ? <span className="text-warn-400">{lang === "pt" ? "entre para salvar" : "sign in to save"}</span> : saved === "limit" ? <span className="text-warn-400" data-testid="ticket-limit">{limitNote}</span> : saved === "paused" ? <span className="text-warn-400" data-testid="ticket-paused">{t("pausedHint")}</span> : (
                <>
                  <input aria-label={lang === "pt" ? "Valor apostado (R$)" : "Stake (R$)"} value={stake} onChange={(e) => setStake(e.target.value)} placeholder={t("stake")} inputMode="decimal" className="nums w-20 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[12px] text-mist-100 outline-none focus:border-edge-400" data-testid="ticket-stake" />
                  <button onClick={addToBankroll} disabled={!(Number(stake) > 0) || saved === "saving"} className="rounded border border-ink-700 px-2 py-1 text-mist-300 hover:border-ink-600 hover:text-mist-100 disabled:opacity-40" data-testid="ticket-add">{t("addToBankroll")}</button>
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
  const pct = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)} pp`;
  return (
    <details className="group mt-3 rounded-lg border border-ink-700/80 bg-ink-900/40" data-testid="alternatives" open={flaggedPlayers.size > 0}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12px] font-medium text-mist-200">
        <span className="text-edge-400 transition group-open:rotate-90">›</span>
        {alternatives.length === 1 ? (lang === "pt" ? "1 alternativa" : "1 alternative") : lang === "pt" ? `${alternatives.length} alternativas` : `${alternatives.length} alternatives`}
        <span className="text-mist-500">· {lang === "pt" ? "se essa cair, vai de…" : "if this one breaks, go with…"}</span>
      </summary>
      <ul className="flex flex-col gap-2 px-3 pb-3">
        {alternatives.map((alt) => {
          const diff = legDiff(main, alt);
          const highlight = avoids(alt);
          return (
            <li key={alt.id} className={`rounded-lg border p-2.5 ${highlight ? "border-edge-400/60 bg-edge-400/[0.06]" : "border-ink-800 bg-ink-900/70"}`} data-testid="alternative">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-semibold text-mist-100">{alt.title}</span>
                {highlight && <span className="rounded bg-edge-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-edge-400" data-testid="alt-avoids">{lang === "pt" ? "alternativa sem ele" : "backup without him"}</span>}
                <span className="nums ml-auto rounded bg-signal-500/12 px-1.5 py-0.5 text-[12px] font-bold text-signal-400">{formatDecimal(alt.combinedDecimal)}</span>
              </div>
              {alt.swapReason && <p className="mt-1 text-[11.5px] text-mist-400">{lang === "pt" ? "Quando trocar" : "When to switch"}: {alt.swapReason}</p>}
              <ul className="mt-1.5 flex flex-col gap-0.5 text-[12px]" data-testid="alt-diff">
                {diff.removed.map((sel) => <li key={`r-${sel}`} className="text-mist-500 line-through decoration-alert-400/70">− {sel}</li>)}
                {diff.added.map((sel) => <li key={`a-${sel}`} className="text-edge-400">+ {sel}</li>)}
                {diff.kept.map((sel) => <li key={`k-${sel}`} className="text-mist-400">= {sel}</li>)}
              </ul>
              <p className="nums mt-1.5 text-[11px] text-mist-500">
                {lang === "pt" ? "preço" : "price"} {formatDecimal(main.combinedDecimal)} → {formatDecimal(alt.combinedDecimal)} · {lang === "pt" ? "chance estimada" : "modelled chance"} {pct(alt.modelledProbability - main.modelledProbability)}
              </p>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function BetsPanel({ slate, lang, gameId, sportKey, alerts = [] }: { slate: BetSlate | null | undefined; lang: Lang; gameId?: string; sportKey?: string; alerts?: LegAlertView[] }) {
  const t = makeT(lang);
  if (!slate?.suggestions.length) {
    return (
      <>
        <Empty>{t("noBets")}</Empty>
        {slate?.dataNote && <p className="mt-2 text-[12px] leading-relaxed text-mist-500">{slate.dataNote}</p>}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {groupAlternatives(slate.suggestions).map(({ main, alternatives }) => (
          <Ticket key={main.id} bet={main} lang={lang} gameId={gameId} sportKey={sportKey} alerts={alerts.filter((a) => a.suggestionId === main.id)} alternatives={alternatives} />
        ))}
      </ul>
      {slate.dataNote && (
        <p className="border-t border-ink-800 pt-2.5 text-[11.5px] leading-relaxed text-mist-500">{slate.dataNote}</p>
      )}
    </div>
  );
}
