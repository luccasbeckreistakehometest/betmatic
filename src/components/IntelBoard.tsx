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
        ) : mine ? (
          <>
            {mine.delayed && (
              <p className="mb-3 rounded-lg border border-warn-400/25 bg-warn-400/5 px-3 py-2 text-[12px] text-warn-400">
                {t("delayedNotice")}
              </p>
            )}
            <BetsPanel slate={mine.slate} lang={lang} />
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <Empty>{data?.authenticated ? t("noTicketsYet") : t("signInForTickets")}</Empty>
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
