"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BetsPanel } from "@/components/BetsPanel";
import { useNavState } from "@/components/Controls";
import { Empty, Panel } from "@/components/ui";
import { makeT } from "@/lib/i18n";
import type { BetSlate } from "@/lib/types";

interface Served {
  matchup: string;
  generatedAt: string;
  slate: BetSlate;
}

interface Payload {
  predictions: Served[];
  plan: { id: string; name: string; crossGame: boolean };
  authenticated: boolean;
  paused: { until: string | null } | null;
}

type BuildState = "idle" | "running" | "done" | "too_few_games" | "cap_global" | "failed";

/** Cross-game tickets: read from inventory; a plan that includes them builds the day's slate once. */
export function ParlayBuilder() {
  const { lang, sport, params } = useNavState();
  const t = makeT(lang);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ scope: "slate", sport: sport.key, lang });
      const date = params.get("date");
      if (date) query.set("date", date);
      const response = await fetch(`/api/predictions?${query}`, { cache: "no-store" });
      setData(await response.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [sport.key, lang, params]);

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      await load();
    })();
  }, [load]);

  const slate = data?.predictions[0] ?? null;
  const locked = data && !data.plan.crossGame;
  const [build, setBuild] = useState<BuildState>("idle");
  const [buildMessage, setBuildMessage] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setBuild("running");
    try {
      const r = await fetch(`/api/parlays/generate?sport=${sport.key}&lang=${lang}`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (j.status === "generated" || j.status === "exists") {
        setBuild("done");
        await load();
      } else if (j.status === "too_few_games" || j.status === "cap_global") {
        setBuild(j.status);
      } else {
        setBuild("failed");
        setBuildMessage(j.message ?? null);
      }
    } catch {
      setBuild("failed");
      setBuildMessage(t("networkError"));
    }
  }, [sport.key, lang, load, t]);

  const canBuild = !!data && data.authenticated && !locked && !data.paused && !slate;
  useEffect(() => {
    if (loading || !canBuild || build !== "idle") return;
    const id = setTimeout(() => void generate(), 0);
    return () => clearTimeout(id);
  }, [loading, canBuild, build, generate]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white">
          {t("crossGame")} <span className="text-mist-500">· {sport.label[lang]}</span>
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-mist-400">{t("crossGameHint")}</p>
      </div>

      <Panel
        title={t("betBuilder")}
        lang={lang}
        status={loading ? "pending" : locked ? "disabled" : slate ? "ok" : "empty"}
        meta={slate?.matchup}
      >
        {loading ? (
          <Empty>{t("loadingTickets")}</Empty>
        ) : locked ? (
          <div className="flex flex-col gap-3">
            <Empty>{t("crossGameLocked")}</Empty>
            <Link
              href={`/planos?lang=${lang}`}
              className="w-fit rounded-lg bg-edge-400 px-3.5 py-1.5 text-[13px] font-semibold text-ink-950 transition hover:bg-edge-500"
            >
              {t("seePlans")}
            </Link>
          </div>
        ) : slate ? (
          <BetsPanel slate={slate.slate} lang={lang} sportKey={sport.key} />
        ) : build === "running" ? (
          <div className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-850 px-3 py-3 text-[13px] text-mist-300" data-testid="generating-slate">
            <span className="h-3 w-3 animate-pulse rounded-full bg-edge-400" />{t("generatingSlate")}
          </div>
        ) : (
          <Empty>
            {build === "too_few_games" ? t("slateTooFew") : build === "cap_global" ? t("capGlobal") : build === "failed" ? buildMessage ?? t("generateFailed") : data?.authenticated ? t("noTicketsYet") : t("signInForTickets")}
          </Empty>
        )}
      </Panel>
    </div>
  );
}
