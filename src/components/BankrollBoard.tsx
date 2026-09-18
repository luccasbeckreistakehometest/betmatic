"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { Badge, Button, Empty, ErrorState, Input, KPI, LinkButton, Notice, PageHead, Panel, Table, Td, Th, Tr } from "@/components/ui";
import { LineChart } from "@/components/Chart";
import { Icon } from "@/components/Icon";
import { useNavState } from "@/components/Controls";
import { makeT } from "@/lib/i18n";
import { formatDecimal } from "@/lib/odds";
import { EquityChart } from "@/components/EquityChart";
import { LossReview } from "@/components/LossReview";
import { SlipScanner } from "@/components/SlipScanner";

interface EntryLeg { selection: string; outcome: string; actual?: string; settlement?: unknown }
interface Entry { id: string; source: "ticket" | "manual" | "custom" | "scan"; title: string; matchup: string; combinedDecimal: number; stake: number; outcome: string; pnl: number; createdAt: string; settledAt: string | null; slug: string | null; legs?: EntryLeg[]; autoLegs?: number; alerts?: { kind: string; player: string }[]; clv?: { pct: number; n: number; moved: number } }
interface Payload { entries: Entry[]; totals: { staked: number; profit: number; roi: number; won: number; lost: number; pending: number }; streak?: { streak: number; notice: boolean }; pause?: { paused: boolean; until: string | null }; error?: string }

export function BankrollBoard() {
  const { lang, sport } = useNavState();
  const t = makeT(lang);
  const [data, setData] = useState<Payload | null>(null);
  const [title, setTitle] = useState(""); const [odds, setOdds] = useState(""); const [stake, setStake] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const money = (n: number, signed = false) => formatMoney(n, lang, { signed });
  /** 422 = over a stake ceiling, 423 = paused; anything else is a generic failure. */
  const explainAddError = (status: number, j: { reason?: string; remainingDaily?: number | null; remainingWeekly?: number | null; pausedUntil?: string | null }) =>
    status === 423 ? t("pausedBlock").replace("{date}", j.pausedUntil ? formatDate(j.pausedUntil, lang, { year: true }) : "—")
    : status === 422 ? (j.reason === "weekly" ? t("limitWeekly") : t("limitDaily")).replace("{left}", money(j.reason === "weekly" ? j.remainingWeekly ?? 0 : j.remainingDaily ?? 0))
    : t("generateFailed");

  const load = useCallback(async () => { const r = await fetch("/api/bankroll", { cache: "no-store" }); setData(await r.json()); }, []);
  useEffect(() => { const id = setTimeout(() => void load(), 0); return () => clearTimeout(id); }, [load]);

  async function addManual() {
    setAddError(null);
    const r = await fetch("/api/bankroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "manual", title, odds: Number(odds), stake: Number(stake) }) });
    if (!r.ok) { setAddError(explainAddError(r.status, await r.json().catch(() => ({})))); return; }
    setTitle(""); setOdds(""); setStake(""); await load();
  }
  const grade = async (id: string, outcome: string) => { await fetch("/api/bankroll", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, outcome }) }); await load(); };
  const remove = async (id: string) => { await fetch(`/api/bankroll?id=${id}`, { method: "DELETE" }); await load(); };
  /** A settled result is the only thing that earns a hue. Pending is a word, in ink. */
  const tone = (o: string) => (o === "won" ? "text-pos" : o === "lost" ? "text-neg" : "text-fg-dim");
  const rowTone = (o: string): "pos" | "neg" | undefined => (o === "won" ? "pos" : o === "lost" ? "neg" : undefined);

  // The user's own money curve: decided entries in settlement order, cumulative profit in currency.
  const own = (data?.entries ?? []).filter((e) => e.outcome === "won" || e.outcome === "lost").sort((a, b) => (a.settledAt ?? a.createdAt).localeCompare(b.settledAt ?? b.createdAt));
  const ownPoints = own.reduce<{ at: string; units: number }[]>((acc, e) => [...acc, { at: e.settledAt ?? e.createdAt, units: (acc.at(-1)?.units ?? 0) + e.pnl }], []);

  if (data?.error) {
    return (
      <Panel title={t("bankroll")}>
        <Empty action={<LinkButton href={`/login?lang=${lang}`} variant="primary">{t("login")}</LinkButton>}>{t("signInForBankroll")}</Empty>
      </Panel>
    );
  }

  const mark = { won: t("markWon"), lost: t("markLost"), void: t("markVoid"), push: "push", pending: "…" } as Record<string, string>;

  return (
    <div className="flex flex-col gap-4" data-testid="bankroll">
      <PageHead
        kicker={lang === "pt" ? "Banca" : "Bankroll"}
        title={t("bankroll")}
        meta={t("bankrollIntro")}
        actions={
          data ? (
            <span className="nums text-tiny text-fg-dim">
              {data.totals.won}W {data.totals.lost}L · {data.totals.pending} {lang === "pt" ? "pendentes" : "pending"}
            </span>
          ) : undefined
        }
      />

      {data?.streak?.notice && (
        <div data-testid="streak-notice">
          <Notice>{t("streakNoticeText").replace("{n}", String(data.streak.streak))}</Notice>
        </div>
      )}

      {/* The three numbers that answer "how am I doing", on one rule above everything else. */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-4 border-y border-line py-4 sm:grid-cols-3" data-testid="bankroll-totals">
        <KPI label={t("staked")} value={data ? money(data.totals.staked) : "—"} />
        <KPI
          label={t("profit")}
          value={data ? money(data.totals.profit, true) : "—"}
          tone={data && data.totals.profit > 0 ? "pos" : data && data.totals.profit < 0 ? "neg" : undefined}
        />
        <KPI
          label={t("roi")}
          value={data ? formatPercent(data.totals.roi, lang) : "—"}
          sub={data ? `${data.totals.won + data.totals.lost} ${lang === "pt" ? "decididos" : "decided"}` : undefined}
          tone={data && data.totals.roi > 0 ? "pos" : data && data.totals.roi < 0 ? "neg" : undefined}
        />
      </div>

      {!data?.pause?.paused && <SlipScanner lang={lang} sportKey={sport.key} onSaved={() => void load()} />}

      <Panel flush>
        {data?.entries.length ? (
          <Table caption={t("bankroll")}>
            <thead>
              <tr>
                <Th className="w-20">{lang === "pt" ? "Resultado" : "Result"}</Th>
                <Th>{lang === "pt" ? "Bilhete" : "Ticket"}</Th>
                <Th numeric className="w-20">{lang === "pt" ? "Odd" : "Odds"}</Th>
                <Th numeric className="w-24">{t("stake")}</Th>
                <Th numeric className="w-20">CLV</Th>
                <Th numeric className="w-28">{t("profit")}</Th>
                <Th className="w-40">{lang === "pt" ? "Ações" : "Actions"}</Th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <Tr key={e.id} tone={rowTone(e.outcome)} data-testid="bankroll-entry">
                  <Td label={lang === "pt" ? "Resultado" : "Result"} className={`font-medium ${tone(e.outcome)}`}>{mark[e.outcome] ?? e.outcome}</Td>
                  <Td label={lang === "pt" ? "Bilhete" : "Ticket"} className="min-w-0">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-fg">{e.title}</span>
                      <span className="text-fg-dim">{e.matchup}</span>
                      {e.alerts?.length ? (
                        <span data-testid="entry-alert" title={e.alerts.map((a) => a.player).join(", ")}>
                          <Badge tone="neg">
                            {lang === "pt" ? `escalação: ${e.alerts.length === 1 ? "1 perna em risco" : `${e.alerts.length} pernas em risco`}` : `lineup: ${e.alerts.length === 1 ? "1 leg at risk" : `${e.alerts.length} legs at risk`}`}
                          </Badge>
                        </span>
                      ) : null}
                    </span>
                    {(e.source === "custom" || e.source === "scan") && e.legs?.length ? (
                      <ul className="mt-1 flex flex-col gap-0.5 text-tiny" data-testid="entry-legs">
                        {e.legs.map((l, i) => (
                          <li key={i} className="flex flex-wrap items-baseline gap-2">
                            <span className={`w-3 shrink-0 ${tone(l.outcome)}`}>{l.outcome === "won" ? "✓" : l.outcome === "lost" ? "✗" : l.outcome === "void" ? "∅" : "·"}</span>
                            <span className="text-fg-muted">{l.selection}</span>
                            {l.settlement ? (
                              <span data-testid="auto-grade" className="text-micro u-label text-fg-dim">{lang === "pt" ? "liquidação automática" : "graded automatically"}</span>
                            ) : (
                              <span className="text-micro u-label text-fg-faint">{lang === "pt" ? "você marca" : "you grade it"}</span>
                            )}
                            {l.actual && <span className="nums text-micro text-fg-dim">{l.actual}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {e.source === "ticket" && e.outcome === "lost" && e.slug && (
                      <div className="mt-1"><LossReview slug={e.slug} lang={lang} compact /></div>
                    )}
                  </Td>
                  <Td numeric label={lang === "pt" ? "Odd" : "Odds"} className="text-fg-muted">{formatDecimal(e.combinedDecimal, lang)}</Td>
                  <Td numeric label={t("stake")} className="text-fg-muted">{money(e.stake)}</Td>
                  <Td
                    numeric
                    label="CLV"
                    className={e.clv?.n && e.clv.pct > 0 ? "text-pos" : "text-fg-dim"}
                    title={lang === "pt" ? "Preço que você pegou comparado com o fechamento, sem a margem" : "Your price compared with the close, margin removed"}
                    data-testid={e.clv && (e.clv.n > 0 || e.clv.moved > 0) ? "entry-clv" : undefined}
                  >
                    {e.clv && (e.clv.n > 0 || e.clv.moved > 0)
                      ? e.clv.n
                        ? `CLV ${formatPercent(e.clv.pct, lang, { signed: true })}`
                        : lang === "pt" ? "linha mudou" : "line moved"
                      : "—"}
                  </Td>
                  <Td numeric label={t("profit")} className={tone(e.outcome)}>
                    {e.outcome === "won" || e.outcome === "lost" ? money(e.pnl, true) : "—"}
                  </Td>
                  <Td label={lang === "pt" ? "Ações" : "Actions"}>
                    <span className="flex items-center gap-1">
                      {e.source !== "ticket" && e.outcome === "pending" &&
                        (["won", "lost", "void"] as const).map((o) => (
                          <button
                            key={o}
                            type="button"
                            onClick={() => grade(e.id, o)}
                            className="border border-line-control px-1.5 py-0.5 text-micro u-label text-fg-muted transition-colors duration-(--dur-1) hover:bg-surface-2 hover:text-fg"
                          >
                            {mark[o]}
                          </button>
                        ))}
                      <button
                        type="button"
                        onClick={() => remove(e.id)}
                        aria-label={lang === "pt" ? "Remover da banca" : "Remove from bankroll"}
                        className="ml-auto grid size-6 place-items-center text-fg-faint transition-colors duration-(--dur-1) hover:text-neg"
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-(--panel-p)"><Empty>{t("bankrollEmpty")}</Empty></div>
        )}
      </Panel>

      {ownPoints.length >= 2 && (
        <Panel title={t("ownCurve")} meta={`${own.length} ${lang === "pt" ? "decididos" : "decided"}`}>
          <div data-testid="own-curve">
            <LineChart
              testId="own"
              caption={t("ownCurve")}
              formatValue={(v) => money(v, true)}
              firstLabel={formatDate(ownPoints[0].at, lang)}
              lastLabel={formatDate(ownPoints[ownPoints.length - 1].at, lang)}
              points={ownPoints.map((p, i) => ({ x: i, value: p.units, label: formatDate(p.at, lang) }))}
            />
          </div>
        </Panel>
      )}

      <EquityChart lang={lang} />

      <Panel title={t("manualBet")}>
        <div className="grid gap-2 sm:grid-cols-[1fr_7rem_7rem_auto]">
          <Input aria-label={lang === "pt" ? "Descrição da aposta" : "Bet description"} maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={lang === "pt" ? "ex.: Flamengo vence @ Bet365" : "e.g. Lakers ML @ DraftKings"} data-testid="manual-title" />
          <Input numeric aria-label={lang === "pt" ? "Odd (decimal)" : "Odds (decimal)"} value={odds} onChange={(e) => setOdds(e.target.value)} placeholder="1,85" inputMode="decimal" data-testid="manual-odds" />
          <Input numeric aria-label={lang === "pt" ? "Valor apostado (R$)" : "Stake (R$)"} value={stake} onChange={(e) => setStake(e.target.value)} placeholder={t("stake")} inputMode="decimal" data-testid="manual-stake" />
          <Button variant="primary" onClick={addManual} disabled={!title.trim() || !(Number(odds) > 1) || !(Number(stake) > 0) || !!data?.pause?.paused} data-testid="manual-add">{t("addToBankroll")}</Button>
        </div>
        {addError && <div className="mt-2" data-testid="add-error"><ErrorState title={addError} /></div>}
      </Panel>

      <p className="text-tiny text-fg-dim">
        <Link href={{ pathname: "/app/track", query: { lang } }} className="underline underline-offset-2 hover:text-fg">{t("navTrack")}</Link>
      </p>
    </div>
  );
}
