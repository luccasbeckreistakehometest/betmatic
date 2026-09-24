"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BetsPanel, type GamePricesView } from "@/components/BetsPanel";
import { useNavState } from "@/components/Controls";
import { Empty, Panel, buttonClass } from "@/components/ui";
import { makeT } from "@/lib/i18n";
import { crossWindowLabel } from "@/lib/bets/cross-policy";
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
  /** The slate day the tickets were served for: the books' prices are asked for the same day. */
  dateKey: string;
}

type BuildState = "idle" | "running" | "done" | "too_few_games" | "cap_global" | "cap_user" | "cap_admin" | "failed";

/**
 * "As múltiplas do dia entre jogos": the section they live in.
 *
 * Nothing here generates on arrival. The scheduler builds the day's slate for every sport with two
 * upcoming games or more (server/cross-daily.ts), so the page reads inventory that already exists —
 * the button below is the exception, for a sport the scheduler skipped or a grid that filled up
 * after its run, and the reader's own bespoke one is a tap away at /app/parlays/custom.
 *
 * Three answers, and the middle one is the one this section was missing: tickets, "hoje a grade não
 * deu nenhuma boa combinação" with the build's own note under it, and "ainda não saíram". The ticket
 * itself is the card every other screen draws (BetsPanel + TicketDetails); there is no second one.
 */
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

  // The Brazilian books' prices on these tickets, read the same way the game page reads its own:
  // only for tickets the viewer already sees, after them and never blocking them. This is what puts
  // a betslip link under a múltipla — until now the cross-game page asked for no prices at all, so
  // it had no link to give.
  const [prices, setPrices] = useState<GamePricesView | null>(null);
  const dateKey = data?.dateKey ?? null;
  const ticketIds = slate?.slate.suggestions.map((s) => s.id).join(",") ?? "";
  useEffect(() => {
    if (!ticketIds || !dateKey) return;
    let alive = true;
    // Deferred so the effect itself sets no state synchronously.
    const id = setTimeout(() => {
      fetch(`/api/parlays/prices?sport=${sport.key}&lang=${lang}&date=${dateKey}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (alive && j && Array.isArray(j.tickets)) setPrices({ tickets: j.tickets, signals: j.signals ?? [], books: j.books ?? [], fetchedAt: j.fetchedAt ?? null }); })
        .catch(() => {});
    }, 0);
    return () => { alive = false; clearTimeout(id); };
  }, [ticketIds, dateKey, sport.key, lang]);
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
      } else if (j.status === "too_few_games" || j.status === "cap_global" || j.status === "cap_user" || j.status === "cap_admin") {
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
  // The scheduler files a slate even on a night that produced nothing, with the reason in its note.
  // That is a real answer and it is printed as one: "hoje a grade não deu" is information, and an
  // invented ticket to fill the space would be the one thing this product must never do.
  const built = slate?.slate;
  const none = !!built && built.suggestions.length === 0;

  return (
    <div className="flex max-w-[64rem] flex-col gap-4">
      <div className="flex max-w-measure-app flex-col gap-1">
        <p className="text-sm leading-relaxed text-fg-muted">
          <span className="text-fg">{sport.label[lang]}</span> — {t("crossGameHint")}
        </p>
        {/* The window, written from the constants the build is gated on, so the page cannot promise
            a shape the code refuses. */}
        <p className="text-tiny text-fg-dim" data-testid="cross-window">{t("crossWindow").replace("{range}", crossWindowLabel(lang))}</p>
      </div>

      <Panel
        title={t("crossGame")}
        lang={lang}
        status={loading ? "pending" : locked ? "disabled" : none ? "empty" : slate ? "ok" : "empty"}
        meta={slate ? `${slate.matchup}${builtFor ? ` · ${builtFor.slice(6, 8)}/${builtFor.slice(4, 6)}` : ""}` : undefined}
        action={<Link href={`/app/parlays/custom?sport=${sport.key}&lang=${lang}`} className="rounded-control border border-line-control px-2 py-0.5 text-label text-fg-muted transition-colors duration-(--dur-1) ease-(--ease-out) hover:border-line-control hover:text-fg max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:px-3" data-testid="custom-parlay-link">{t("customParlay")}</Link>}
      >
        {loading ? (
          <Empty>{t("loadingTickets")}</Empty>
        ) : locked ? (
          <div className="flex flex-col gap-3">
            <Empty>{t("crossGameLocked")}</Empty>
            <Link
              href={`/planos?lang=${lang}`}
              className={buttonClass("primary", "w-fit")}
            >
              {t("seePlans")}
            </Link>
          </div>
        ) : none ? (
          <div className="flex flex-col gap-3" data-testid="cross-none">
            <Empty>{t("crossNone")}</Empty>
            {built.dataNote && <p className="max-w-measure-app text-tiny leading-relaxed text-fg-dim">{built.dataNote}</p>}
            <p className="text-tiny text-fg-dim">{t("slateHonesty")}</p>
          </div>
        ) : slate ? (
          <div className="flex flex-col gap-3">
            <BetsPanel slate={built!} lang={lang} sportKey={sport.key} prices={prices} />
            <p className="border-t border-line pt-2.5 text-tiny leading-relaxed text-fg-dim" data-testid="cross-honesty">{t("slateHonesty")}</p>
          </div>
        ) : build === "running" ? (
          <div className="flex items-center gap-3 rounded-control border border-line-strong bg-surface-2 px-3 py-3 text-sm text-fg-muted" data-testid="generating-slate">
            <span aria-hidden="true" className="live-dot size-1.5 rounded-full bg-fg-dim" />{t("generatingSlate")}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Empty>
              {build === "too_few_games" ? t("slateTooFew") : build === "cap_global" ? t("capGlobal") : build === "cap_admin" ? t("capAdmin") : build === "cap_user" ? t("slateCapUser") : build === "failed" ? buildMessage ?? t("generateFailed") : data?.authenticated ? t("slateEmpty") : t("signInForTickets")}
            </Empty>
            {canBuild && (build === "idle" || build === "failed") && (
              <button onClick={() => void generate()} data-testid="build-slate" className={buttonClass("primary", "w-fit")}>
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
