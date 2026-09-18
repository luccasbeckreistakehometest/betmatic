"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/format";
import Link from "next/link";
import { Empty, Panel, Select, buttonClass } from "@/components/ui";
import { useNavState } from "@/components/Controls";
import { makeT } from "@/lib/i18n";
import { formatMoney } from "@/lib/format";

interface Settings { bankrollAmount: number | null; dailyStakeCap: number | null; weeklyStakeCap: number | null; sessionReminderMinutes: number | null; lossStreakNotice: number; pausedUntil: string | null; leaderboardOptIn: boolean; handle: string | null }
interface Payload { settings: Settings; pause: { paused: boolean; until: string | null; daysLeft: number }; staked: { today: number; week: number }; streak: { streak: number; notice: boolean }; error?: string }

/**
 * Responsible-play settings: stake ceilings, the session reminder, the losing-streak notice and
 * the self-exclusion pause. Every rule is enforced on the server; this page only sets them.
 */
export function SettingsPanel() {
  const { lang } = useNavState();
  const t = makeT(lang);
  const [data, setData] = useState<Payload | null>(null);
  const [daily, setDaily] = useState("");
  const [weekly, setWeekly] = useState("");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [confirmPause, setConfirmPause] = useState(false);
  const [optIn, setOptIn] = useState(false);
  const [bankroll, setBankroll] = useState("");
  const [handle, setHandle] = useState("");
  const [handleError, setHandleError] = useState<string | null>(null);
  const money = (n: number) => formatMoney(n, lang);
  const fmtDate = (iso: string) => formatDate(iso, lang, { year: true });

  const apply = useCallback((j: Payload) => {
    setData(j);
    if (j.settings) {
      setDaily(j.settings.dailyStakeCap === null ? "" : String(j.settings.dailyStakeCap));
      setWeekly(j.settings.weeklyStakeCap === null ? "" : String(j.settings.weeklyStakeCap));
      setOptIn(j.settings.leaderboardOptIn);
      setBankroll(j.settings.bankrollAmount === null || j.settings.bankrollAmount === undefined ? "" : String(j.settings.bankrollAmount));
      setHandle(j.settings.handle ?? "");
    }
  }, []);
  useEffect(() => { const id = setTimeout(() => { fetch("/api/settings", { cache: "no-store" }).then((r) => r.json()).then(apply).catch(() => {}); }, 0); return () => clearTimeout(id); }, [apply]);

  const patch = useCallback(async (body: Record<string, unknown>) => {
    setSaved("saving"); setHandleError(null);
    const r = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (r.ok) { apply(j); setSaved("saved"); setTimeout(() => setSaved("idle"), 1500); }
    else { setSaved("error"); if (j.error === "handle_taken") setHandleError(t("handleTaken")); else if (/handle/.test(String(j.error))) setHandleError(t("handleInvalid")); }
    return r.ok;
  }, [apply, t]);

  async function pause(days: 7 | 30) {
    const r = await fetch("/api/settings/pause", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }) });
    if (r.ok) { const j = await r.json(); setData((d) => (d ? { ...d, settings: j.settings, pause: j.pause } : d)); setConfirmPause(false); }
  }

  if (data?.error) return <Panel className="max-w-[56rem]" title={t("settingsTitle")}><Empty>{t("signInForSettings")}</Empty><Link href="/login" className="mt-2 inline-block text-sm text-fg underline underline-offset-2">{lang === "pt" ? "Entrar" : "Log in"}</Link></Panel>;
  const s = data?.settings;
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const input = "nums w-36 rounded-control border border-line-control bg-surface-1 px-3 py-2 text-sm text-fg";

  return (
    <div className="flex flex-col gap-4" data-testid="settings">
      {data?.pause.paused && (
        <div className="rounded-panel border border-warn bg-warn-tint px-4 py-3 text-sm text-warn" data-testid="pause-banner">
          <span className="font-semibold">{t("pausedUntil")} {fmtDate(data.pause.until!)}</span> · {data.pause.daysLeft} {t("daysLeft")}. {t("pausedHint")}
        </div>
      )}

      <Panel className="max-w-[56rem]" title={t("limitsTitle")} meta={data ? `${t("stakedSoFar")}: ${money(data.staked.today)} / 24h · ${money(data.staked.week)} / 7d` : undefined}>
        <p className="text-tiny text-fg-dim">{t("limitsIntro")}</p>
        {/* The inputs appear only once the saved values are in: a late load must never wipe what was typed. */}
        {!data ? <p className="mt-3 text-tiny text-fg-dim">…</p> : (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-label text-fg-dim">{t("dailyCap")}<input value={daily} onChange={(e) => setDaily(e.target.value)} placeholder={t("noCap")} inputMode="decimal" className={input} data-testid="cap-daily" /></label>
          <label className="flex flex-col gap-1 text-label text-fg-dim">{t("weeklyCap")}<input value={weekly} onChange={(e) => setWeekly(e.target.value)} placeholder={t("noCap")} inputMode="decimal" className={input} data-testid="cap-weekly" /></label>
          <button onClick={() => void patch({ dailyStakeCap: num(daily), weeklyStakeCap: num(weekly) })} disabled={saved === "saving" || (daily.trim() !== "" && !(Number(daily) > 0)) || (weekly.trim() !== "" && !(Number(weekly) > 0))} className={buttonClass("primary")} data-testid="limits-save">{t("save")}</button>
          {saved === "saved" && <span className="text-tiny text-pos" data-testid="limits-saved">{t("savedOk")}</span>}
        </div>
        )}
      </Panel>

      <Panel className="max-w-[56rem]" title={lang === "pt" ? "Sua banca (opcional)" : "Your bankroll (optional)"}>
        <p className="text-tiny text-fg-dim">
          {lang === "pt"
            ? "Quanto você separou para apostar, no total. Serve só para o relatório da semana mostrar quando um valor apostado passou muito do tamanho sensato (¼ Kelly). Não é compartilhado."
            : "How much you set aside for betting, in total. It only lets the weekly report show when a stake went well past a sensible size (¼ Kelly). It is never shared."}
        </p>
        {data && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <input aria-label={lang === "pt" ? "Banca (R$)" : "Bankroll"} value={bankroll} onChange={(e) => setBankroll(e.target.value)} inputMode="decimal" placeholder={lang === "pt" ? "R$ —" : "—"} className={input} data-testid="bankroll-amount" />
            <button onClick={() => void patch({ bankrollAmount: num(bankroll) })} disabled={saved === "saving" || (bankroll.trim() !== "" && !(Number(bankroll) > 0))} className="rounded-control border border-line-control px-3 py-2 text-tiny text-fg-muted hover:text-fg disabled:bg-surface-3 disabled:text-fg-faint disabled:cursor-not-allowed" data-testid="bankroll-amount-save">{t("save")}</button>
          </div>
        )}
      </Panel>

      <Panel className="max-w-[56rem]" title={t("reminderTitle")}>
        <p className="text-tiny text-fg-dim">{t("reminderIntro")}</p>
        <Select wrapperClassName="mt-3 block" aria-label={t("reminderTitle")} value={s?.sessionReminderMinutes ?? 0} onChange={(e) => void patch({ sessionReminderMinutes: Number(e.target.value) || null })} data-testid="reminder-select">
          <option value={0}>{t("reminderOff")}</option>
          {[1, 15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} {t("minutes")}</option>)}
        </Select>
      </Panel>

      <Panel className="max-w-[56rem]" title={t("streakTitle")} meta={data ? `${data.streak.streak} ${lang === "pt" ? "seguidas agora" : "in a row now"}` : undefined}>
        <p className="text-tiny text-fg-dim">{t("streakIntro")}</p>
        <Select wrapperClassName="mt-3 block" aria-label={t("streakTitle")} value={s?.lossStreakNotice ?? 3} onChange={(e) => void patch({ lossStreakNotice: Number(e.target.value) })} data-testid="streak-select">
          <option value={0}>{t("streakOff")}</option>
          {[2, 3, 4, 5, 7].map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
      </Panel>

      <Panel className="max-w-[56rem]" title={t("pauseTitle")}>
        <p className="text-tiny text-fg-dim">{t("pauseIntro")}</p>
        <SelfExclusionLinks lang={lang} />
        {data?.pause.paused ? (
          <p className="mt-3 text-sm text-warn">{t("pausedUntil")} {fmtDate(data.pause.until!)}.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm text-fg"><input type="checkbox" checked={confirmPause} onChange={(e) => setConfirmPause(e.target.checked)} className="size-4 appearance-none rounded-control border border-line-control bg-surface-3 checked:border-warn checked:bg-warn" data-testid="pause-confirm" />{t("pauseConfirm")}</label>
            <div className="flex gap-2">
              <button onClick={() => void pause(7)} disabled={!confirmPause} className="rounded-control border border-warn px-3.5 py-2 text-sm font-semibold text-warn hover:bg-warn-tint disabled:bg-surface-3 disabled:text-fg-faint disabled:cursor-not-allowed" data-testid="pause-7">{t("pause7")}</button>
              <button onClick={() => void pause(30)} disabled={!confirmPause} className="rounded-control border border-warn px-3.5 py-2 text-sm font-semibold text-warn hover:bg-warn-tint disabled:bg-surface-3 disabled:text-fg-faint disabled:cursor-not-allowed" data-testid="pause-30">{t("pause30")}</button>
            </div>
          </div>
        )}
      </Panel>

      <Panel className="max-w-[56rem]" title={t("rankingTitle")}>
        <p className="text-tiny text-fg-dim">{t("rankingOptInIntro")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-fg"><input type="checkbox" checked={optIn} onChange={(e) => { setOptIn(e.target.checked); void patch({ leaderboardOptIn: e.target.checked }); }} className="size-4 appearance-none rounded-control border border-line-control bg-surface-3 checked:border-action checked:bg-action" data-testid="ranking-optin" />{t("rankingOptIn")}</label>
          <input aria-label={t("handle")} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={t("handle")} maxLength={16} className={`${input} w-44`} data-testid="ranking-handle" />
          <button onClick={() => void patch({ handle: handle.trim() || null })} disabled={saved === "saving"} className="rounded-control border border-line-control px-3 py-2 text-tiny text-fg-muted hover:text-fg" data-testid="ranking-handle-save">{t("save")}</button>
          {handleError && <span className="text-tiny text-warn" data-testid="handle-error">{handleError}</span>}
          {s?.leaderboardOptIn && s.handle && <span className="text-tiny text-fg-dim">{t("shownAs")} <span className="nums text-fg">@{s.handle}</span></span>}
        </div>
        <Link href={{ pathname: "/app/ranking", query: { lang } }} className="mt-2 inline-block text-tiny text-fg underline decoration-line-control underline-offset-2 hover:decoration-fg">{t("navRanking")} →</Link>
      </Panel>
    </div>
  );
}

/** The official self-exclusion platform and CVV, shown wherever a pause is offered. */
export function SelfExclusionLinks({ lang }: { lang: "pt" | "en" }) {
  return (
    <p className="mt-2 text-tiny leading-relaxed text-fg-muted" data-testid="self-exclusion">
      {lang === "pt" ? "Quer bloquear todas as casas autorizadas de uma vez? Use a " : "Want to block every licensed Brazilian book at once? Use the "}
      <a href="https://autoexclusaoapostas.fazenda.gov.br" target="_blank" rel="noreferrer" className="text-fg underline decoration-line-control underline-offset-2 hover:decoration-fg">
        {lang === "pt" ? "Plataforma Centralizada de Autoexclusão" : "federal self-exclusion platform (Plataforma Centralizada de Autoexclusão)"}
      </a>
      {lang === "pt" ? " do governo. Se precisar conversar, o CVV atende de graça no 188, 24 horas." : ". If you need to talk, CVV answers for free on 188, 24 hours a day (Brazil)."}
    </p>
  );
}
