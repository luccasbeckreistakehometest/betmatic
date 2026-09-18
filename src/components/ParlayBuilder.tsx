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

type BuildState = "idle" | "running" | "done" | "too_few_games" | "cap_global" | "cap_user" | "failed";

/** Cross-game tickets: read from inventory; a plan that includes them builds the day's slate once. */
export function ParlayBuilder() {
  const { lang, sport, params } = useNavState();
  const t = makeT(lang);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [builtFor, setBuiltFor] = useState<string | null>(null);

  const load = useCallback(async (dateKey?: string) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ scope: "slate", sport: sport.key, lang });
      const date = dateKey ?? params.get("date");
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
        if (j.dateKey) setBuiltFor(j.dateKey);
        await load(j.dateKey);
      } else if (j.status === "too_few_games" || j.status === "cap_global" || j.status === "cap_user") {
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

  // Generation costs real money, so it only starts on an explicit click.
  const canBuild = !!data && data.authenticated && !locked && !data.paused && !slate;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lead font-semibold tracking-tight text-fg">
          {t("crossGame")} <span className="text-fg-dim">· {sport.label[lang]}</span>
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-muted">{t("crossGameHint")}</p>
      </div>

      <Panel
        title={t("betBuilder")}
        lang={lang}
        status={loading ? "pending" : locked ? "disabled" : slate ? "ok" : "empty"}
        meta={slate ? `${slate.matchup}${builtFor ? ` · ${builtFor.slice(6, 8)}/${builtFor.slice(4, 6)}` : ""}` : undefined}
        action={<Link href={`/app/parlays/custom?sport=${sport.key}&lang=${lang}`} className="rounded-control border border-line-strong px-2 py-0.5 text-label text-fg-muted transition-colors duration-(--dur-1) ease-(--ease-out) hover:border-line-control hover:text-fg" data-testid="custom-parlay-link">{t("customParlay")}</Link>}
      >
        {loading ? (
          <Empty>{t("loadingTickets")}</Empty>
        ) : locked ? (
          <div className="flex flex-col gap-3">
            <Empty>{t("crossGameLocked")}</Empty>
            <Link
              href={`/planos?lang=${lang}`}
              className="w-fit rounded-control bg-action px-3.5 py-1.5 text-sm font-semibold text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover"
            >
              {t("seePlans")}
            </Link>
          </div>
        ) : slate ? (
          <BetsPanel slate={slate.slate} lang={lang} sportKey={sport.key} />
        ) : build === "running" ? (
          <div className="flex items-center gap-3 rounded-control border border-line-strong bg-surface-2 px-3 py-3 text-sm text-fg-muted" data-testid="generating-slate">
            <span className="h-3 w-3 animate-pulse rounded-full bg-action" />{t("generatingSlate")}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Empty>
              {build === "too_few_games" ? t("slateTooFew") : build === "cap_global" ? t("capGlobal") : build === "cap_user" ? t("slateCapUser") : build === "failed" ? buildMessage ?? t("generateFailed") : data?.authenticated ? t("slateEmpty") : t("signInForTickets")}
            </Empty>
            {canBuild && (build === "idle" || build === "failed") && (
              <button onClick={() => void generate()} data-testid="build-slate" className="w-fit rounded-control bg-action px-3.5 py-1.5 text-sm font-semibold text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover">
                {t("buildSlate")}
              </button>
            )}
            {canBuild && <p className="text-tiny text-fg-dim">{t("slateHonesty")}</p>}
          </div>
        )}
      </Panel>
    </div>
  );
}
