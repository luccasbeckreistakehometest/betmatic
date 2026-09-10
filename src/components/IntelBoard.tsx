"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Chip, Empty, Panel } from "@/components/ui";
import { BetsPanel } from "@/components/BetsPanel";
import { useNavState } from "@/components/Controls";
import { ODDS_BANDS } from "@/lib/odds";
import { makeT } from "@/lib/i18n";
import type { BetSlate, GameBrief, PickRow, PropRow, SourceResult, SourceStatus, XIntel } from "@/lib/types";

type SourceKey = "x" | "propscash" | "mamaknowsbets" | "dimers" | "brief" | "bets";
type Slot = { status: SourceStatus | "pending" | "idle"; result: SourceResult<unknown> | null };

// The board auto-gathers on mount, so it starts in the pending state rather than flipping into it
// from inside the effect — that would be a synchronous setState cascade.
const PENDING: Record<SourceKey, Slot> = {
  x: { status: "pending", result: null },
  propscash: { status: "pending", result: null },
  mamaknowsbets: { status: "pending", result: null },
  dimers: { status: "pending", result: null },
  brief: { status: "pending", result: null },
  bets: { status: "pending", result: null },
};

function relTime(iso?: string): string {
  if (!iso) return "";
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return "";
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function PickList({ picks }: { picks: PickRow[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {picks.map((pick, i) => (
        <li key={`${pick.label}-${i}`} className="rounded-lg border border-ink-800 bg-ink-850/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-mist-100">{pick.selection}</span>
            <span className="nums text-[12px] text-mist-300">{pick.odds ?? ""}</span>
            <span className="text-[11px] text-mist-500">{pick.book ?? ""}</span>
            {pick.confidence && <Chip>{pick.confidence}</Chip>}
            <span className="ml-auto text-[11px] uppercase tracking-wide text-mist-500">{pick.market}</span>
          </div>
          {pick.rationale && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-mist-400">{pick.rationale}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function SourceNote({ result }: { result: SourceResult<unknown> | null }) {
  if (!result?.error) return null;
  const tone = result.status === "needs-login" ? "text-warn-400" : "text-mist-500";
  return <p className={`mt-2 text-[12px] leading-relaxed ${tone}`}>{result.error}</p>;
}

export function IntelBoard({ gameId }: { gameId: string }) {
  const { lang, sport } = useNavState();
  const t = makeT(lang);
  const [bands, setBands] = useState<string[]>(["value", "mid", "long", "moonshot"]);
  const [slots, setSlots] = useState<Record<SourceKey, Slot>>(PENDING);
  const [running, setRunning] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [fatal, setFatal] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const gather = useCallback(
    async (force: boolean, only?: SourceKey[], markPending = true) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // The mount run skips this block — the board already renders in the pending state.
      if (markPending) {
        setFatal(null);
        setRunning(true);
        setElapsed(0);
        setSlots((prev) => {
          const next = { ...prev };
          for (const key of only ?? (Object.keys(prev) as SourceKey[])) {
            next[key] = { status: "pending", result: null };
          }
          // A targeted refresh still regenerates the brief, since its inputs changed.
          if (only && !only.includes("brief")) next.brief = { status: "pending", result: null };
          return next;
        });
      }

      const params = new URLSearchParams();
      if (force) params.set("force", "1");
      if (only) params.set("only", [...only, "brief", "bets"].join(","));
      params.set("sport", sport.key);
      params.set("lang", lang);
      params.set("bands", bands.join(","));

      try {
        const response = await fetch(`/api/intel/${gameId}/stream?${params}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok || !response.body) throw new Error(`Gather failed (${response.status})`);
        const isCurrent = () => abortRef.current === controller;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            if (!isCurrent()) return;
            const event = JSON.parse(line);
            if (event.type === "source") {
              setSlots((prev) => ({
                ...prev,
                [event.name as SourceKey]: { status: event.result.status, result: event.result },
              }));
            } else if (event.type === "error") {
              setFatal(event.message);
            }
          }
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError" && abortRef.current === controller) {
          setFatal(error instanceof Error ? error.message : "Gather failed");
        }
      } finally {
        // Only the run that still owns the ref may clear the board.
        if (abortRef.current === controller) {
          setRunning(false);
          setSlots((prev) => {
            const next = { ...prev };
            for (const key of Object.keys(next) as SourceKey[]) {
              if (next[key].status === "pending") next[key] = { status: "idle", result: null };
            }
            return next;
          });
        }
      }
    },
    [gameId, sport.key, lang, bands],
  );

  useEffect(() => {
    // State already reflects "gathering"; the effect only kicks off the external work, and every
    // update it produces lands in an async continuation after network I/O.
    void (async () => {
      await Promise.resolve();
      await gather(false, undefined, false);
    })();
    return () => abortRef.current?.abort();
  }, [gather]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const refreshButton = (only?: SourceKey[]) => (
    <button
      onClick={() => void gather(true, only)}
      disabled={running}
      className="rounded-md border border-ink-700 px-2 py-0.5 text-[11px] text-mist-400 transition hover:border-ink-600 hover:text-mist-100 disabled:opacity-40"
    >
      {t("refresh")}
    </button>
  );

  const brief = slots.brief.result?.data as GameBrief | null | undefined;
  const xIntel = slots.x.result?.data as XIntel | null | undefined;
  const props = (slots.propscash.result?.data as { props: PropRow[]; notes: string[] } | null | undefined)?.props ?? [];
  const picksData = slots.mamaknowsbets.result?.data as { picks: PickRow[]; notes: string[] } | null | undefined;
  const picks = picksData?.picks ?? [];
  const dimersData = slots.dimers.result?.data as { picks: PickRow[]; notes: string[] } | null | undefined;
  const dimersPicks = dimersData?.picks ?? [];

  const betSlate = slots.bets.result?.data as BetSlate | null | undefined;
  const sortedProps = [...props].sort((a, b) => (b.edgePct ?? -Infinity) - (a.edgePct ?? -Infinity));
  const measuredCount = props.filter((p) => p.measured).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void gather(true)}
          disabled={running}
          className="rounded-lg bg-signal-500 px-3.5 py-1.5 text-[13px] font-medium text-ink-950 transition hover:bg-signal-400 disabled:opacity-50"
        >
          {running ? t("gathering") : t("regatherAll")}
        </button>
        {running && (
          <span className="nums text-[12px] text-mist-400">
            {elapsed}s — {t("gatheringHint")}
          </span>
        )}
        {fatal && <span className="text-[12px] text-alert-400">{fatal}</span>}
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
      </div>

      <Panel
        title={t("betBuilder")}
        lang={lang}
        status={slots.bets.status}
        meta={betSlate?.suggestions.length ? `${betSlate.suggestions.length} ${betSlate.suggestions.length === 1 ? "ticket" : "tickets"}` : undefined}
        action={refreshButton(["bets"])}
      >
        {slots.bets.status === "pending" ? (
          <Empty>{t("waitingSources")}</Empty>
        ) : betSlate ? (
          <BetsPanel slate={betSlate} lang={lang} />
        ) : (
          <>
            <Empty>{t("noBets")}</Empty>
            <SourceNote result={slots.bets.result} />
          </>
        )}
      </Panel>

      <Panel
        title={t("synthesisBrief")}
        lang={lang}
        status={slots.brief.status}
        meta={relTime(slots.brief.result?.fetchedAt)}
        action={refreshButton(["brief"])}
      >
        {brief ? (
          <div className="flex flex-col gap-3.5">
            <p className="text-[14px] leading-relaxed text-mist-100">{brief.headline}</p>

            {brief.keyAngles.length > 0 && (
              <ul className="flex flex-col gap-2">
                {brief.keyAngles.map((angle, i) => (
                  <li key={i} className="rounded-lg border border-ink-800 bg-ink-850/60 p-3">
                    <div className="flex items-start gap-2">
                      <Chip tone={angle.confidence}>{angle.confidence}</Chip>
                      <span className="text-[13px] leading-relaxed text-mist-100">{angle.angle}</span>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-mist-400">{angle.support}</p>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              {([
                [t("injuryWatch"), brief.injuryWatch, "text-warn-400"],
                [t("conflicts"), brief.conflicts, "text-alert-400"],
                [t("notCovered"), brief.missingData, "text-mist-500"],
              ] as const).map(([label, items, tone]) =>
                items.length ? (
                  <div key={label}>
                    <h3 className={`text-[10px] font-semibold uppercase tracking-wider ${tone}`}>{label}</h3>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {items.map((item, i) => (
                        <li key={i} className="text-[12px] leading-relaxed text-mist-400">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>

            <p className="border-t border-ink-800 pt-2.5 text-[11px] leading-relaxed text-mist-500">
              {brief.disclaimer}
            </p>
          </div>
        ) : slots.brief.status === "pending" ? (
          <Empty>{t("waitingSources")}</Empty>
        ) : (
          <>
            <Empty>{t("noBriefYet")}</Empty>
            <SourceNote result={slots.brief.result} />
          </>
        )}
      </Panel>

      <Panel
        title={t("insiderReporting")}
        lang={lang}
        status={slots.x.status}
        meta={
          slots.x.result?.meta
            ? `${slots.x.result.meta.scanned ?? 0} posts scanned · ${slots.x.result.meta.accounts ?? 0} accounts`
            : relTime(slots.x.result?.fetchedAt)
        }
        action={refreshButton(["x"])}
      >
        {xIntel?.items.length ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-relaxed text-mist-300">{xIntel.summary}</p>
            <ul className="flex flex-col gap-2">
              {xIntel.items.map((item) => (
                <li key={item.tweetId} className="rounded-lg border border-ink-800 bg-ink-850/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={item.relevance}>{item.relevance}</Chip>
                    <span className="text-[11px] text-mist-500">{item.category}</span>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[12px] font-medium text-signal-400 hover:underline"
                    >
                      @{item.handle}
                    </a>
                    <span className="ml-auto text-[11px] text-mist-500">{relTime(item.postedAt)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-mist-200">{item.text}</p>
                  {item.bettingImpact && item.bettingImpact.toLowerCase() !== "none" && (
                    <p className="mt-2 border-l-2 border-signal-500/40 pl-2.5 text-[12px] leading-relaxed text-mist-400">
                      {item.bettingImpact}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : slots.x.status === "pending" ? (
          <Empty>{t("statusPending")}</Empty>
        ) : (
          <>
            <Empty>{xIntel?.summary ?? t("nothingFromX")}</Empty>
            <SourceNote result={slots.x.result} />
          </>
        )}
      </Panel>

      <Panel
        title={t("playerProps")}
        lang={lang}
        status={slots.propscash.status}
        meta={props.length ? `${props.length} rows · ${measuredCount} ${t("measured")}` : relTime(slots.propscash.result?.fetchedAt)}
        action={refreshButton(["propscash"])}
      >
        {sortedProps.length ? (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-ink-800 text-[10px] uppercase tracking-wider text-mist-500">
                  <th className="px-1 pb-2 font-medium">{t("player")}</th>
                  <th className="px-1 pb-2 font-medium">{t("market")}</th>
                  <th className="px-1 pb-2 text-right font-medium">{t("line")}</th>
                  <th className="px-1 pb-2 font-medium">{t("side")}</th>
                  <th className="px-1 pb-2 text-right font-medium">{t("odds")}</th>
                  <th className="px-1 pb-2 text-right font-medium">{t("projection")}</th>
                  <th className="px-1 pb-2 text-right font-medium">Edge</th>
                  <th className="px-1 pb-2 font-medium">{t("measured")}</th>
                  <th className="px-1 pb-2 font-medium">{t("book")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800/70">
                {sortedProps.map((row, i) => (
                  <tr key={`${row.player}-${row.market}-${i}`} className="hover:bg-ink-850/60">
                    <td className="px-1 py-1.5 text-mist-100">{row.player}</td>
                    <td className="px-1 py-1.5 text-mist-300">{row.market}</td>
                    <td className="nums px-1 py-1.5 text-right text-mist-200">{row.line ?? "—"}</td>
                    <td className="px-1 py-1.5 uppercase text-mist-300">{row.side ?? "—"}</td>
                    <td className="nums px-1 py-1.5 text-right text-mist-200">{row.odds ?? "—"}</td>
                    <td className="nums px-1 py-1.5 text-right text-mist-200">{row.projection ?? "—"}</td>
                    <td
                      className={`nums px-1 py-1.5 text-right font-medium ${
                        (row.edgePct ?? 0) > 0 ? "text-edge-400" : "text-mist-400"
                      }`}
                    >
                      {row.edgePct !== undefined ? `${row.edgePct}%` : "—"}
                    </td>
                    <td className="nums px-1 py-1.5 text-[11px]">
                      {row.measured ? (
                        <span
                          className={
                            row.measured.impliedFair >= 0.6
                              ? "text-edge-400"
                              : row.measured.impliedFair <= 0.4
                                ? "text-alert-400"
                                : "text-mist-300"
                          }
                          title={row.measured.sampleNote}
                        >
                          {row.measured.last5.hits}/{row.measured.last5.of} · {row.measured.last10.hits}/
                          {row.measured.last10.of} · {row.measured.season.hits}/{row.measured.season.of}
                        </span>
                      ) : (
                        <span className="text-mist-600">{t("noGamelog")}</span>
                      )}
                    </td>
                    <td className="px-1 py-1.5 text-mist-400">{row.book ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : slots.propscash.status === "pending" ? (
          <Empty>{t("statusPending")}</Empty>
        ) : (
          <>
            <Empty>{t("noProps")}</Empty>
            <SourceNote result={slots.propscash.result} />
          </>
        )}
      </Panel>

      <Panel
        title={t("publishedPicks")}
        lang={lang}
        status={slots.mamaknowsbets.status}
        meta={picks.length ? `${picks.length} picks` : relTime(slots.mamaknowsbets.result?.fetchedAt)}
        action={refreshButton(["mamaknowsbets"])}
      >
        {picks.length ? (
          <PickList picks={picks} />
        ) : slots.mamaknowsbets.status === "pending" ? (
          <Empty>{t("statusPending")}</Empty>
        ) : (
          <>
            <Empty>{t("noPicks")}</Empty>
            <SourceNote result={slots.mamaknowsbets.result} />
          </>
        )}
      </Panel>

      <Panel
        title={t("modelProjections")}
        lang={lang}
        status={slots.dimers.status}
        meta={dimersPicks.length ? `${dimersPicks.length} plays` : relTime(slots.dimers.result?.fetchedAt)}
        action={refreshButton(["dimers"])}
      >
        {dimersPicks.length || dimersData?.notes?.length ? (
          <div className="flex flex-col gap-3">
            {dimersData?.notes?.length ? (
              <ul className="flex flex-col gap-1 rounded-lg border border-ink-800 bg-ink-850/60 p-3">
                {dimersData.notes.map((note, i) => (
                  <li key={i} className="text-[12px] leading-relaxed text-mist-300">
                    {note}
                  </li>
                ))}
              </ul>
            ) : null}
            {dimersPicks.length > 0 && <PickList picks={dimersPicks} />}
          </div>
        ) : slots.dimers.status === "pending" ? (
          <Empty>{t("statusPending")}</Empty>
        ) : (
          <>
            <Empty>{t("noProjections")}</Empty>
            <SourceNote result={slots.dimers.result} />
          </>
        )}
      </Panel>
    </div>
  );
}
