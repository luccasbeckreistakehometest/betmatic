"use client";

import { track } from "@/lib/track";
import { useCallback, useEffect, useState } from "react";
import { formatDateTime } from "@/lib/format";
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

  if (data?.error) return <Panel title={t("alertsTitle")}><Empty>{t("signInForAlerts")}</Empty><Link href="/login" className="mt-2 inline-block text-sm text-pos hover:underline">{lang === "pt" ? "Entrar" : "Log in"}</Link></Panel>;

  const tg = data?.telegram;
  const followingLeague = (key: string) => data?.follows.some((f) => f.kind === "league" && f.sportKey === key) ?? false;
  const teams = data?.follows.filter((f) => f.kind === "team") ?? [];
  const groups = [["basketball", lang === "pt" ? "Basquete" : "Basketball"], ["soccer", lang === "pt" ? "Futebol" : "Soccer"]] as const;
  const when = (iso: string) => formatDateTime(iso, lang);

  return (
    <div className="flex flex-col gap-4" data-testid="alerts">
      {tg?.configured && (
        <Panel title={t("alertsTitle")} meta={tg.linked ? `@${tg.username || "…"}` : undefined}>
          <p className="text-tiny text-fg-dim">{t("alertsIntro")}</p>
          {tg.linked ? (
            <div className="mt-3 flex flex-col gap-3" data-testid="telegram-status" data-linked="1">
              <p className="text-sm font-semibold text-pos">✓ {t("telegramLinked")}</p>
              <label className="flex items-center gap-2 text-sm text-fg">
                <input type="checkbox" checked={tg.digest} disabled={busy} onChange={(e) => void act({ action: "digest", on: e.target.checked })} data-testid="digest-toggle" className="size-4 appearance-none rounded-control border border-line-control bg-surface-3 checked:border-action checked:bg-action" />
                {t("digestDaily")}
              </label>
              <p className="text-tiny text-fg-dim">{t("digestHint")}</p>
              <button onClick={() => void act({ action: "unlink" })} disabled={busy} className="w-fit rounded-control border border-line-strong px-3 py-1.5 text-tiny text-fg-muted hover:text-warn" data-testid="telegram-unlink">{t("telegramUnlink")}</button>
            </div>
          ) : tg.code ? (
            <div className="mt-3 flex flex-col gap-2" data-testid="telegram-status" data-linked="0">
              <code className="nums w-fit rounded-control border border-pos bg-surface-1 px-4 py-2 text-lead font-semibold tracking-[0.2em] text-pos" data-testid="telegram-code">{tg.code}</code>
              <p className="text-tiny text-fg-muted">{t("telegramCodeHint")}</p>
              <div className="flex flex-wrap gap-2">
                {tg.deepLink && <a href={tg.deepLink} target="_blank" rel="noopener noreferrer" className="rounded-control bg-action px-3 py-1.5 text-tiny font-semibold text-focus hover:bg-action" data-testid="telegram-open">{t("telegramOpenBot")}{tg.botUsername ? ` (@${tg.botUsername})` : ""}</a>}
                <button onClick={() => void act({ action: "link_code" })} disabled={busy} className="rounded-control border border-line-strong px-3 py-1.5 text-tiny text-fg-muted hover:text-fg">{t("telegramNewCode")}</button>
                <button onClick={() => void load()} className="rounded-control border border-line-strong px-3 py-1.5 text-tiny text-fg-muted hover:text-fg" data-testid="telegram-refresh">{t("refresh")}</button>
              </div>
            </div>
          ) : (
            <div className="mt-3" data-testid="telegram-status" data-linked="0">
              <button onClick={() => { track("telegram_link_started"); void act({ action: "link_code" }); }} disabled={busy} className="rounded-control bg-action px-3.5 py-2 text-sm font-semibold text-action-fg hover:bg-action disabled:opacity-50" data-testid="telegram-connect">{t("telegramConnect")}</button>
            </div>
          )}
        </Panel>
      )}

      <Panel title={t("following")} meta={data ? `${data.follows.length}` : undefined}>
        {!tg?.configured && <p className="mb-3 text-tiny text-fg-dim">{t("alertsIntro")}</p>}
        <h3 className="text-micro font-semibold uppercase tracking-wider text-fg-dim">{t("followLeagues")}</h3>
        <div className="mt-2 flex flex-col gap-2">
          {groups.map(([group, label]) => (
            <div key={group} className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-tiny text-fg-dim">{label}</span>
              {(data?.leagues ?? []).filter((l) => l.group === group).map((l) => {
                const on = followingLeague(l.key);
                return (
                  <button key={l.key} disabled={busy} onClick={() => void act({ action: on ? "unfollow" : "follow", kind: "league", sportKey: l.key })} data-testid={`league-${l.key}`} data-on={on ? "1" : "0"}
                    className={`rounded-control border px-2.5 py-1 text-tiny transition ${on ? "border-pos bg-action text-pos" : "border-line-strong text-fg-muted hover:border-line-control hover:text-fg"}`}>
                    {on ? "✓ " : ""}{l.label[lang]}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <h3 className="mt-4 text-micro font-semibold uppercase tracking-wider text-fg-dim">{t("followTeams")}</h3>
        {teams.length ? (
          <ul className="mt-2 flex flex-wrap gap-2" data-testid="followed-teams">
            {teams.map((f) => (
              <li key={`${f.sportKey}:${f.key}`} className="flex items-center gap-2 rounded-control border border-line-strong px-2.5 py-1 text-tiny text-fg">
                {f.label || f.key}
                <button disabled={busy} onClick={() => void act({ action: "unfollow", kind: "team", sportKey: f.sportKey, key: f.key })} className="text-fg-dim hover:text-warn" title={t("unfollow")}>✕</button>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-tiny text-fg-dim">{t("followTeamsHint")}</p>}
      </Panel>

      <Panel title={t("notifications")} meta={data && data.unread > 0 ? `${data.unread} ${lang === "pt" ? "novos" : "new"}` : undefined}
        action={data && data.unread > 0 ? <button onClick={() => void act({ action: "read", ids: null })} className="text-label text-fg-muted hover:text-fg" data-testid="mark-read">{t("markAllRead")}</button> : undefined}>
        {data?.notifications.length ? (
          <ul className="divide-y divide-line" data-testid="notifications">
            {data.notifications.map((n) => (
              <li key={n.id} className="flex flex-col gap-1 py-2.5 text-sm" data-testid="notification" data-status={n.status}>
                <div className="flex flex-wrap items-center gap-2">
                  {n.status === "unread" && <span className="size-1.5 rounded-full bg-action" />}
                  <span className={n.status === "unread" ? "font-semibold text-fg" : "text-fg-muted"}>{n.title}</span>
                  {n.channel === "telegram" && <span className="rounded-control border border-line-strong px-1.5 py-0.5 text-micro uppercase tracking-wide text-fg-dim">{t("sentOnTelegram")}</span>}
                  <span className="nums ml-auto text-label text-fg-dim">{when(n.createdAt)}</span>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-tiny leading-relaxed text-fg-muted">{n.body}</pre>
                {n.url && <a href={n.url} className="w-fit text-tiny text-pos hover:underline">{t("openTicket")} →</a>}
              </li>
            ))}
          </ul>
        ) : <Empty>{t("noNotifications")}</Empty>}
      </Panel>
    </div>
  );
}
