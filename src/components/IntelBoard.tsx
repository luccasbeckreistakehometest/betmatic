"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BetsPanel } from "@/components/BetsPanel";
import { useNavState } from "@/components/Controls";
import { Empty, Panel } from "@/components/ui";
import { makeT } from "@/lib/i18n";
import type { BetSlate } from "@/lib/types";

interface Served {
  gameId: string | null;
  matchup: string;
  generatedAt: string;
  slate: BetSlate;
  delayed: boolean;
}

interface Payload {
  predictions: Served[];
  plan: { id: string; name: string; bands: string[]; delayMinutes: number };
  authenticated: boolean;
  paused: { until: string | null } | null;
}

function relTime(iso?: string, lang: "pt" | "en" = "pt"): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return lang === "pt" ? "agora" : "just now";
  if (mins < 60) return lang === "pt" ? `há ${mins}min` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return lang === "pt" ? `há ${hours}h` : `${hours}h ago`;
  return lang === "pt" ? `há ${Math.round(hours / 24)}d` : `${Math.round(hours / 24)}d ago`;
}

/**
 * Reads pre-generated tickets for one game. Generation happens in the background job — a user
 * opening a page must never spend model credit, or cost would scale with traffic.
 */
export function IntelBoard({ gameId, dateKey }: { gameId: string; dateKey?: string }) {
  const { lang, sport } = useNavState();
  const t = makeT(lang);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [gen, setGen] = useState<"idle" | "running" | "done" | "capUser" | "capGlobal" | "gameStarted" | "aiOff" | "generateFailed">("idle");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ scope: "game", sport: sport.key, lang });
      if (dateKey) params.set("date", dateKey);
      const response = await fetch(`/api/predictions?${params}`, { cache: "no-store" });
      setData(await response.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [sport.key, lang, dateKey]);

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      await load();
    })();
  }, [load]);

  const mine = data?.predictions.find((p) => p.gameId === gameId) ?? null;

  // Opening a game that has no tickets yet builds them. Signed-in only; the server enforces caps.
  const generate = useCallback(async () => {
    setGen("running");
    try {
      const r = await fetch(`/api/game/${gameId}/generate?sport=${sport.key}`, { method: "POST" });
      const j = await r.json().catch(() => ({ status: "error" }));
      const map: Record<string, typeof gen> = { generated: "done", exists: "done", cap_user: "capUser", cap_global: "capGlobal", started: "gameStarted", ai_off: "aiOff" };
      setGen(map[j.status] ?? "generateFailed");
      if (j.status === "generated" || j.status === "exists") await load();
    } catch { setGen("generateFailed"); }
  }, [gameId, sport.key, load]);

  const authenticated = data?.authenticated ?? false;
  const paused = !!data?.paused;
  useEffect(() => {
    if (loading || !authenticated || paused || mine || gen !== "idle") return;
    // Deferred so the effect itself does not set state synchronously (React Compiler rule).
    const id = setTimeout(() => void generate(), 0);
    return () => clearTimeout(id);
  }, [loading, authenticated, paused, mine, gen, generate]);

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={t("betBuilder")}
        lang={lang}
        status={loading ? "pending" : mine ? "ok" : "empty"}
        meta={mine ? relTime(mine.generatedAt, lang) : undefined}
        action={
          <Link href="/app/slip" className="rounded-md border border-ink-700 px-2 py-0.5 text-[11px] text-mist-400 transition hover:border-ink-600 hover:text-mist-100">
            {t("mySlip")}
          </Link>
        }
      >
        {loading ? (
          <Empty>{t("loadingTickets")}</Empty>
        ) : data?.paused ? (
          <p className="rounded-lg border border-warn-400/25 bg-warn-400/5 px-3 py-2 text-[13px] text-warn-400" data-testid="tickets-paused">
            {t("pausedTickets").replace("{date}", data.paused.until ? new Date(data.paused.until).toLocaleDateString(lang === "pt" ? "pt-BR" : "en-US") : "—")}
          </p>
        ) : mine ? (
          <>
            {mine.delayed && (
              <p className="mb-3 rounded-lg border border-warn-400/25 bg-warn-400/5 px-3 py-2 text-[12px] text-warn-400">
                {t("delayedNotice")}
              </p>
            )}
            <BetsPanel slate={mine.slate} lang={lang} gameId={gameId} />
          </>
        ) : (
          <div className="flex flex-col gap-2">
            {gen === "running" ? (
              <div className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-850 px-3 py-3 text-[13px] text-mist-300" data-testid="generating">
                <span className="h-3 w-3 animate-pulse rounded-full bg-edge-400" />{t("generatingTickets")}
              </div>
            ) : (
              <Empty>{!data?.authenticated ? t("signInForTickets") : gen === "idle" || gen === "done" ? t("noTicketsYet") : t(gen)}</Empty>
            )}
            {data?.authenticated && (gen === "generateFailed" || gen === "done") && !mine && (
              <button onClick={() => void generate()} className="w-fit rounded-lg bg-edge-400 px-3.5 py-1.5 text-[13px] font-semibold text-ink-950 transition hover:bg-edge-500">{t("generateNow")}</button>
            )}
            {!data?.authenticated && (
              <Link href="/signup" className="w-fit rounded-lg bg-edge-400 px-3.5 py-1.5 text-[13px] font-semibold text-ink-950 transition hover:bg-edge-500">
                {t("startFreeCta")}
              </Link>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
