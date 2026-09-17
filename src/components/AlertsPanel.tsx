"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Empty, Panel } from "@/components/ui";
import { useNavState } from "@/components/Controls";
import { makeT } from "@/lib/i18n";

interface Telegram { configured: boolean; linked: boolean; username: string; digest: boolean; code: string | null; codeExpiresAt: string | null; deepLink: string | null; botUsername: string }
interface Follow { kind: "team" | "league"; sportKey: string; key: string; label: string }
interface Notification { id: string; channel: "telegram" | "inapp"; kind: string; title: string; body: string; url: string; status: string; createdAt: string }
interface Payload { telegram: Telegram; follows: Follow[]; notifications: Notification[]; unread: number; leagues: { key: string; label: { pt: string; en: string }; group: string }[]; error?: string }

export function AlertsPanel() {
  const { lang } = useNavState();
  const t = makeT(lang);
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { const r = await fetch("/api/alerts", { cache: "no-store" }); setData(await r.json()); }, []);
  useEffect(() => { const id = setTimeout(() => void load(), 0); return () => clearTimeout(id); }, [load]);

  const act = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await fetch("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) setData(await r.json());
    } finally { setBusy(false); }
  }, []);

  if (data?.error) return <Panel title={t("alertsTitle")}><Empty>{t("signInForAlerts")}</Empty><Link href="/login" className="mt-2 inline-block text-[13px] text-edge-400 hover:underline">{lang === "pt" ? "Entrar" : "Log in"}</Link></Panel>;

  const tg = data?.telegram;
  const followingLeague = (key: string) => data?.follows.some((f) => f.kind === "league" && f.sportKey === key) ?? false;
  const teams = data?.follows.filter((f) => f.kind === "team") ?? [];
  const groups = [["basketball", lang === "pt" ? "Basquete" : "Basketball"], ["soccer", lang === "pt" ? "Futebol" : "Soccer"], ["tennis", lang === "pt" ? "Tênis" : "Tennis"]] as const;
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "pt" ? "pt-BR" : "en-US", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-col gap-4" data-testid="alerts">
      {tg?.configured && (
        <Panel title={t("alertsTitle")} meta={tg.linked ? `@${tg.username || "…"}` : undefined}>
          <p className="text-[12px] text-mist-500">{t("alertsIntro")}</p>
          {tg.linked ? (
            <div className="mt-3 flex flex-col gap-3" data-testid="telegram-status" data-linked="1">
              <p className="text-[13px] font-semibold text-edge-400">✓ {t("telegramLinked")}</p>
              <label className="flex items-center gap-2 text-[13px] text-mist-200">
                <input type="checkbox" checked={tg.digest} disabled={busy} onChange={(e) => void act({ action: "digest", on: e.target.checked })} data-testid="digest-toggle" className="accent-edge-400" />
                {t("digestDaily")}
              </label>
              <p className="text-[11.5px] text-mist-500">{t("digestHint")}</p>
              <button onClick={() => void act({ action: "unlink" })} disabled={busy} className="w-fit rounded-lg border border-ink-700 px-3 py-1.5 text-[12px] text-mist-400 hover:text-warn-400" data-testid="telegram-unlink">{t("telegramUnlink")}</button>
            </div>
          ) : tg.code ? (
            <div className="mt-3 flex flex-col gap-2" data-testid="telegram-status" data-linked="0">
              <code className="nums w-fit rounded-lg border border-edge-400/40 bg-ink-900 px-4 py-2 text-xl font-semibold tracking-[0.2em] text-edge-400" data-testid="telegram-code">{tg.code}</code>
              <p className="text-[12px] text-mist-400">{t("telegramCodeHint")}</p>
              <div className="flex flex-wrap gap-2">
                {tg.deepLink && <a href={tg.deepLink} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-signal-400/15 px-3 py-1.5 text-[12px] font-semibold text-signal-400 hover:bg-signal-400/25" data-testid="telegram-open">{t("telegramOpenBot")}{tg.botUsername ? ` (@${tg.botUsername})` : ""}</a>}
                <button onClick={() => void act({ action: "link_code" })} disabled={busy} className="rounded-lg border border-ink-700 px-3 py-1.5 text-[12px] text-mist-300 hover:text-mist-100">{t("telegramNewCode")}</button>
                <button onClick={() => void load()} className="rounded-lg border border-ink-700 px-3 py-1.5 text-[12px] text-mist-300 hover:text-mist-100" data-testid="telegram-refresh">{t("refresh")}</button>
              </div>
            </div>
          ) : (
            <div className="mt-3" data-testid="telegram-status" data-linked="0">
              <button onClick={() => void act({ action: "link_code" })} disabled={busy} className="rounded-lg bg-edge-400 px-3.5 py-2 text-[13px] font-semibold text-ink-950 hover:bg-edge-500 disabled:opacity-50" data-testid="telegram-connect">{t("telegramConnect")}</button>
            </div>
          )}
        </Panel>
      )}

      <Panel title={t("following")} meta={data ? `${data.follows.length}` : undefined}>
        {!tg?.configured && <p className="mb-3 text-[12px] text-mist-500">{t("alertsIntro")}</p>}
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-mist-500">{t("followLeagues")}</h3>
        <div className="mt-2 flex flex-col gap-2">
          {groups.map(([group, label]) => (
            <div key={group} className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-[12px] text-mist-500">{label}</span>
              {(data?.leagues ?? []).filter((l) => l.group === group).map((l) => {
                const on = followingLeague(l.key);
                return (
                  <button key={l.key} disabled={busy} onClick={() => void act({ action: on ? "unfollow" : "follow", kind: "league", sportKey: l.key })} data-testid={`league-${l.key}`} data-on={on ? "1" : "0"}
                    className={`rounded-lg border px-2.5 py-1 text-[12px] transition ${on ? "border-edge-400/50 bg-edge-400/10 text-edge-400" : "border-ink-700 text-mist-300 hover:border-ink-600 hover:text-mist-100"}`}>
                    {on ? "✓ " : ""}{l.label[lang]}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <h3 className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-mist-500">{t("followTeams")}</h3>
        {teams.length ? (
          <ul className="mt-2 flex flex-wrap gap-2" data-testid="followed-teams">
            {teams.map((f) => (
              <li key={`${f.sportKey}:${f.key}`} className="flex items-center gap-2 rounded-lg border border-ink-700 px-2.5 py-1 text-[12px] text-mist-200">
                {f.label || f.key}
                <button disabled={busy} onClick={() => void act({ action: "unfollow", kind: "team", sportKey: f.sportKey, key: f.key })} className="text-mist-500 hover:text-warn-400" title={t("unfollow")}>✕</button>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-[12px] text-mist-500">{t("followTeamsHint")}</p>}
      </Panel>

      <Panel title={t("notifications")} meta={data && data.unread > 0 ? `${data.unread} ${lang === "pt" ? "novos" : "new"}` : undefined}
        action={data && data.unread > 0 ? <button onClick={() => void act({ action: "read", ids: null })} className="text-[11px] text-mist-400 hover:text-mist-100" data-testid="mark-read">{t("markAllRead")}</button> : undefined}>
        {data?.notifications.length ? (
          <ul className="divide-y divide-ink-800" data-testid="notifications">
            {data.notifications.map((n) => (
              <li key={n.id} className="flex flex-col gap-1 py-2.5 text-[13px]" data-testid="notification" data-status={n.status}>
                <div className="flex flex-wrap items-center gap-2">
                  {n.status === "unread" && <span className="size-1.5 rounded-full bg-edge-400" />}
                  <span className={n.status === "unread" ? "font-semibold text-mist-100" : "text-mist-300"}>{n.title}</span>
                  {n.channel === "telegram" && <span className="rounded border border-ink-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-mist-500">{t("sentOnTelegram")}</span>}
                  <span className="nums ml-auto text-[11px] text-mist-500">{when(n.createdAt)}</span>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-mist-400">{n.body}</pre>
                {n.url && <a href={n.url} className="w-fit text-[12px] text-edge-400 hover:underline">{t("openTicket")} →</a>}
              </li>
            ))}
          </ul>
        ) : <Empty>{t("noNotifications")}</Empty>}
      </Panel>
    </div>
  );
}
