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
}

/** Cross-game tickets come from the same background inventory; nothing generates on view. */
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
              href="/#planos"
              className="w-fit rounded-lg bg-edge-400 px-3.5 py-1.5 text-[13px] font-semibold text-ink-950 transition hover:bg-edge-500"
            >
              {t("seePlans")}
            </Link>
          </div>
        ) : slate ? (
          <BetsPanel slate={slate.slate} lang={lang} />
        ) : (
          <Empty>{t("noTicketsYet")}</Empty>
        )}
      </Panel>
    </div>
  );
}
