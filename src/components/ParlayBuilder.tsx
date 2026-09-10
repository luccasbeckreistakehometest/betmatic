"use client";

import { useCallback, useState } from "react";
import { BetsPanel } from "@/components/BetsPanel";
import { useNavState } from "@/components/Controls";
import { Empty, Panel } from "@/components/ui";
import { ODDS_BANDS } from "@/lib/odds";
import { makeT } from "@/lib/i18n";
import type { BetSlate } from "@/lib/types";

interface Result extends BetSlate {
  dateKey?: string;
  games?: number;
  error?: string;
}

export function ParlayBuilder() {
  const { lang, sport, params } = useNavState();
  const t = makeT(lang);
  const [bands, setBands] = useState<string[]>(["long", "moonshot"]);
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const build = useCallback(async () => {
    setRunning(true);
    setResult(null);
    setElapsed(0);
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    try {
      const query = new URLSearchParams({ sport: sport.key, lang, bands: bands.join(",") });
      const date = params.get("date");
      if (date) query.set("date", date);
      const response = await fetch(`/api/slate-bets?${query}`, { cache: "no-store" });
      setResult(await response.json());
    } catch (error) {
      setResult({
        suggestions: [],
        dataNote: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      clearInterval(timer);
      setRunning(false);
    }
  }, [sport.key, lang, bands, params]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white">
          {t("crossGame")} <span className="text-mist-500">· {sport.label[lang]}</span>
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-mist-400">{t("crossGameHint")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-mist-500">{t("oddsRange")}</span>
        {ODDS_BANDS.map((band) => {
          const on = bands.includes(band.key);
          return (
            <button
              key={band.key}
              onClick={() => setBands((prev) => (on ? prev.filter((b) => b !== band.key) : [...prev, band.key]))}
              disabled={running}
              className={`rounded-lg border px-2.5 py-1 text-[11px] transition disabled:opacity-40 ${
                on
                  ? "border-signal-500/50 bg-signal-500/12 text-signal-400"
                  : "border-ink-700 bg-ink-850 text-mist-500 hover:text-mist-300"
              }`}
              title={band.typicalLegs}
            >
              {band.label[lang]}
            </button>
          );
        })}
        <button
          onClick={() => void build()}
          disabled={running || !bands.length}
          className="ml-auto rounded-lg bg-signal-500 px-3.5 py-1.5 text-[13px] font-medium text-ink-950 transition hover:bg-signal-400 disabled:opacity-50"
        >
          {running ? t("building") : t("build")}
        </button>
      </div>

      <Panel
        title={t("betBuilder")}
        lang={lang}
        status={running ? "pending" : result ? (result.suggestions.length ? "ok" : "empty") : "idle"}
        meta={
          result?.games
            ? `${result.games} ${result.games === 1 ? t("game") : t("games")} · ${result.dateKey ?? ""}`
            : running
              ? `${elapsed}s`
              : undefined
        }
      >
        {running ? (
          <Empty>{t("building")}</Empty>
        ) : result?.error ? (
          <Empty>{result.error}</Empty>
        ) : result ? (
          <BetsPanel slate={result} lang={lang} />
        ) : (
          <Empty>{t("crossGameHint")}</Empty>
        )}
      </Panel>
    </div>
  );
}
