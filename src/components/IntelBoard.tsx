"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BetsPanel, type LegAlertView } from "@/components/BetsPanel";
import { RefreshBar } from "@/components/RefreshBar";
import { useNavState } from "@/components/Controls";
import { Empty, Panel, buttonClass } from "@/components/ui";
import { makeT, type DictKey } from "@/lib/i18n";
import { formatDate, formatTime } from "@/lib/format";
import type { BetSlate } from "@/lib/types";
import type { TicketPricesView } from "@/components/PriceComparison";
import type { PropSignal } from "@/lib/sources/br-books/compare";

interface Served {
  gameId: string | null;
  matchup: string;
  generatedAt: string;
  slate: BetSlate;
  delayed: boolean;
}

interface Payload {
  predictions: Served[];
  delayedGames: { gameId: string | null; matchup: string; availableAt: string }[];
  plan: { id: string; name: string; bands: string[]; delayMinutes: number; gamesPerDay: number | null };
  dateKey?: string;
  unlocked: { gameId: string; sportKey: string }[] | null;
  authenticated: boolean;
  paused: { until: string | null } | null;
}

type GenState =
  | "idle" | "running" | "done" | "capUser" | "capGlobal" | "capAdmin" | "gameStarted" | "aiOff" | "generateFailed"
  | "aiBudget" | "tennisUnsupported" | "planSport" | "rateLimited";

const STATUS_MAP: Record<string, GenState> = {
  generated: "done", exists: "done", cap_user: "capUser", cap_global: "capGlobal", cap_admin: "capAdmin", started: "gameStarted",
  ai_off: "aiOff", ai_budget: "aiBudget", unsupported: "tennisUnsupported", plan_sport: "planSport",
};

function relTime(iso: string | undefined, lang: "pt" | "en"): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return lang === "pt" ? "agora" : "just now";
  if (mins < 60) return lang === "pt" ? `há ${mins} min` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return lang === "pt" ? `há ${hours} h` : `${hours}h ago`;
  return lang === "pt" ? `há ${Math.round(hours / 24)} d` : `${Math.round(hours / 24)}d ago`;
}

/**
 * The tickets of one game. Opening the page asks the server for them and a game without tickets is
 * built on the spot (signed-in only; the server enforces every cap). On a plan with a daily
 * allowance nothing is spent by browsing: the user confirms the pick with a click.
 */
export function IntelBoard({ gameId, dateKey, started = false }: { gameId: string; dateKey?: string; started?: boolean }) {
  const { lang, sport } = useNavState();
  const t = makeT(lang);
  const pathname = usePathname();
  const search = useSearchParams();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [gen, setGen] = useState<GenState>("idle");
  const [genMessage, setGenMessage] = useState<string | null>(null);
  const [chosen, setChosen] = useState<{ gameId: string; sportKey: string }[]>([]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ scope: "game", sport: sport.key, lang });
      if (dateKey) params.set("date", dateKey);
      const response = await fetch(`/api/predictions?${params}`, { cache: "no-store" });
      setData(response.ok ? await response.json() : null);
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
  const [alerts, setAlerts] = useState<LegAlertView[]>([]);
  const alertDate = data?.dateKey ?? dateKey;
  const hasTickets = !!mine;
  const generatedAt = mine?.generatedAt;
  useEffect(() => {
    if (!hasTickets || !alertDate) return;
    let alive = true;
    // Deferred so the effect itself sets no state synchronously.
    const id = setTimeout(() => {
      fetch(`/api/game/${gameId}/alerts?sport=${sport.key}&lang=${lang}&date=${alertDate}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { alerts: [] }))
        .then((j) => { if (alive) setAlerts(j.alerts ?? []); })
        .catch(() => {});
    }, 0);
    return () => { alive = false; clearTimeout(id); };
  }, [hasTickets, alertDate, gameId, sport.key, lang, generatedAt]);
  // The Brazilian books' prices on these tickets, read the same way as the alerts: only for tickets
  // the viewer already sees, and never blocking the tickets themselves.
  const [prices, setPrices] = useState<{ tickets: TicketPricesView[]; signals: PropSignal[] } | null>(null);
  useEffect(() => {
    if (!hasTickets || !alertDate) return;
    let alive = true;
    const id = setTimeout(() => {
      fetch(`/api/game/${gameId}/prices?sport=${sport.key}&lang=${lang}&date=${alertDate}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (alive && j && Array.isArray(j.tickets)) setPrices({ tickets: j.tickets, signals: j.signals ?? [] }); })
        .catch(() => {});
    }, 0);
    return () => { alive = false; clearTimeout(id); };
  }, [hasTickets, alertDate, gameId, sport.key, lang, generatedAt]);
  const delayed = data?.delayedGames?.find((g) => g.gameId === gameId) ?? null;

  const generate = useCallback(async () => {
    setGen("running");
    setGenMessage(null);
    try {
      const r = await fetch(`/api/game/${gameId}/generate?sport=${sport.key}&lang=${lang}`, { method: "POST" });
      const j = await r.json().catch(() => ({ status: "error" }));
      if (r.status === 429) {
        setGen("rateLimited");
        setGenMessage(j.message ?? null);
        return;
      }
      const next = STATUS_MAP[j.status] ?? "generateFailed";
      if (next === "capUser" && Array.isArray(j.unlocked)) setChosen(j.unlocked);
      if (next === "generateFailed" || next === "aiBudget") setGenMessage(j.message ?? null);
      setGen(next);
      if (next === "done") await load();
    } catch {
      setGen("generateFailed");
      setGenMessage(t("networkError"));
    }
  }, [gameId, sport.key, lang, load, t]);

  const authenticated = data?.authenticated ?? false;
  const paused = !!data?.paused;
  const dailyLimit = data?.plan.gamesPerDay ?? null;
  const picked = data?.unlocked ?? [];
  // A daily-pick plan and a game that is not today's pick yet: ask before spending it.
  const needsPick = authenticated && dailyLimit !== null && !picked.some((g) => g.gameId === gameId);
  const pickUsedUp = needsPick && picked.length >= dailyLimit;
  useEffect(() => {
    if (loading || !authenticated || paused || mine || delayed || gen !== "idle" || needsPick || started) return;
    // Deferred so the effect itself does not set state synchronously (React Compiler rule).
    const id = setTimeout(() => void generate(), 0);
    return () => clearTimeout(id);
  }, [loading, authenticated, paused, mine, delayed, gen, generate, needsPick, started]);

  const here = `${pathname}${search.toString() ? `?${search.toString()}` : ""}`;
  const signupHref = `/signup?lang=${lang}&next=${encodeURIComponent(here)}`;
  const plansHref = `/planos?lang=${lang}`;

  let body: React.ReactNode;
  if (loading) {
    body = <Empty>{t("loadingTickets")}</Empty>;
  } else if (data?.paused) {
    body = (
      <p className="rounded-control border border-warn bg-warn-tint px-3 py-2 text-sm text-warn" data-testid="tickets-paused">
        {t("pausedTickets").replace("{date}", data.paused.until ? formatDate(data.paused.until, lang, { year: true }) : "—")}
      </p>
    );
  } else if (mine) {
    body = (
      <>
        {mine.delayed && (
          <p className="mb-3 rounded-control border border-warn bg-warn-tint px-3 py-2 text-tiny text-warn">{t("delayedNotice")}</p>
        )}
        {data?.plan.id === "max" && !started && <RefreshBar gameId={gameId} sportKey={sport.key} lang={lang} onRefreshed={() => void load()} />}
        {alerts.length > 0 && <LineupBanner alerts={alerts} lang={lang} />}
        <BetsPanel slate={mine.slate} lang={lang} gameId={gameId} sportKey={sport.key} alerts={alerts} prices={prices} />
      </>
    );
  } else if (delayed) {
    body = (
      <div className="flex flex-col gap-2" data-testid="tickets-delayed">
        <p className="rounded-control border border-warn bg-warn-tint px-3 py-2 text-sm text-warn">
          {t("delayedUntil").replace("{time}", formatTime(delayed.availableAt, lang))}
        </p>
        <Link href={plansHref} className={buttonClass("primary", "w-fit")}>{t("seePlans")}</Link>
      </div>
    );
  } else if (!authenticated) {
    body = (
      <div className="flex flex-col gap-2">
        <Empty>{t("signInForTickets")}</Empty>
        <Link href={signupHref} data-testid="signup-for-tickets" className={buttonClass("primary", "w-fit")}>
          {t("startFreeCta")}
        </Link>
      </div>
    );
  } else if (started && gen === "idle") {
    body = <Empty>{t("gameStarted")}</Empty>;
  } else if (pickUsedUp && gen === "idle") {
    const other = picked.find((g) => g.gameId !== gameId);
    body = (
      <div className="flex flex-col gap-2" data-testid="cap-user">
        <Empty>{t("freeGameChosen")}</Empty>
        <div className="flex flex-wrap gap-2">
          {other && (
            <Link href={`/app/game/${other.gameId}?sport=${other.sportKey}&lang=${lang}`} className={buttonClass("secondary", "w-fit")}>
              {t("openChosenGame")}
            </Link>
          )}
          <Link href={plansHref} className={buttonClass("primary", "w-fit")}>{t("seePlans")}</Link>
        </div>
      </div>
    );
  } else if (needsPick && gen === "idle") {
    body = (
      <div className="flex flex-col gap-2" data-testid="daily-pick">
        <Empty>{t("dailyPickPrompt")}</Empty>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => void generate()} data-testid="use-daily-pick" className={buttonClass("primary", "w-fit")}>{t("useDailyPick")}</button>
          <Link href={plansHref} className="text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline">{t("seePlans")}</Link>
        </div>
        <p className="text-tiny text-fg-dim">{t("dailyPickNote")}</p>
      </div>
    );
  } else if (gen === "running") {
    body = (
      <div className="flex items-center gap-3 rounded-control border border-line-strong bg-surface-2 px-3 py-3 text-sm text-fg-muted" data-testid="generating">
        <span aria-hidden="true" className="live-dot size-1.5 rounded-full bg-fg-dim" />{t("generatingTickets")}
      </div>
    );
  } else if (gen === "capUser") {
    const other = chosen.find((g) => g.gameId !== gameId);
    body = (
      <div className="flex flex-col gap-2" data-testid="cap-user">
        <Empty>{data?.plan.gamesPerDay ? t("freeGameChosen") : t("capUser")}</Empty>
        <div className="flex flex-wrap gap-2">
          {other && (
            <Link href={`/app/game/${other.gameId}?sport=${other.sportKey}&lang=${lang}`} className={buttonClass("secondary", "w-fit")}>
              {t("openChosenGame")}
            </Link>
          )}
          <Link href={plansHref} className={buttonClass("primary", "w-fit")}>{t("seePlans")}</Link>
        </div>
      </div>
    );
  } else {
    const message = gen === "idle" || gen === "done" ? t("noTicketsYet") : genMessage ?? t(gen as DictKey);
    body = (
      <div className="flex flex-col gap-2">
        <Empty>{message}</Empty>
        {(gen === "generateFailed" || gen === "done") && (
          <button onClick={() => void generate()} className={buttonClass("primary", "w-fit")}>{t("generateNow")}</button>
        )}
        {gen === "planSport" && (
          <Link href={plansHref} className={buttonClass("primary", "w-fit")}>{t("seePlans")}</Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={t("betBuilder")}
        lang={lang}
        status={loading ? "pending" : mine ? "ok" : "empty"}
        meta={mine ? relTime(mine.generatedAt, lang) : undefined}
        action={
          <Link href={`/app/slip?sport=${sport.key}&lang=${lang}`} className="rounded-control border border-line-control px-2 py-0.5 text-label text-fg-muted transition-colors duration-(--dur-1) ease-(--ease-out) hover:border-line-control hover:text-fg">
            {t("mySlip")}
          </Link>
        }
      >
        {body}
      </Panel>
    </div>
  );
}

const KIND_TEXT: Record<LegAlertView["kind"], { pt: string; en: string }> = {
  bench: { pt: "começa no banco", en: "starts on the bench" },
  out: { pt: "está fora", en: "is out" },
  doubt: { pt: "é dúvida", en: "is doubtful" },
  key_absence: { pt: "não joga", en: "is not playing" },
};

/** "Escalação: Fulano começa no banco — 2 pernas destes bilhetes perderam a base." Informational only. */
function LineupBanner({ alerts, lang }: { alerts: LegAlertView[]; lang: "pt" | "en" }) {
  const byPlayer = new Map<string, { kind: LegAlertView["kind"]; legs: number }>();
  for (const a of alerts) {
    const cur = byPlayer.get(a.player);
    byPlayer.set(a.player, { kind: cur?.kind ?? a.kind, legs: (cur?.legs ?? 0) + 1 });
  }
  return (
    <div className="mb-3 rounded-control border border-neg bg-neg-tint px-3 py-2.5" data-testid="lineup-banner">
      <p className="text-micro u-label text-neg">{lang === "pt" ? "Escalação" : "Lineup"}</p>
      <ul className="mt-1 flex flex-col gap-0.5 text-tiny text-fg">
        {[...byPlayer].map(([player, v]) => (
          <li key={player}>
            {player} {KIND_TEXT[v.kind][lang]} — {lang === "pt" ? (v.legs === 1 ? "1 perna destes bilhetes perdeu a base" : `${v.legs} pernas destes bilhetes perderam a base`) : v.legs === 1 ? "1 leg on these tickets lost its footing" : `${v.legs} legs on these tickets lost their footing`}.
          </li>
        ))}
      </ul>
      <p className="mt-1 text-tiny text-fg-dim">{lang === "pt" ? "As alternativas sem ele aparecem destacadas embaixo de cada bilhete." : "Backups without him are highlighted under each ticket."}</p>
    </div>
  );
}
