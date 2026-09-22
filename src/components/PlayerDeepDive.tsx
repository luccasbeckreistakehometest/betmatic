"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useNavState } from "@/components/Controls";
import { Empty, LinkButton, PageHead, Panel, chipClass } from "@/components/ui";
import { PlayerChart } from "@/components/PlayerChart";
import { PLAYER_COPY } from "@/components/player-copy";
import { DvpCard, num, PlansLink, PostedLines, RatesGrid, RoleCard, SplitCard } from "@/components/PlayerPanels";
import { PlayerReadCard, type ReadState } from "@/components/PlayerReadCard";
import { gameTotal, rateAt, rateTable } from "@/lib/props/rates";
import { lineRange, type PlayerProfileView } from "@/lib/props/player-view";
import { formatDate, formatDateTime } from "@/lib/format";
import { PanelSkeleton } from "@/components/AppPageHead";

interface Payload { profile: PlayerProfileView; read: ReadState["read"]; access: { unlimited: boolean; used: number; limit: number | null }; readPrice: number; coins: number; aiReady: boolean }
type Load = { state: "loading" } | { state: "ok"; data: Payload } | { state: "error"; code: "signin" | "cap" | "notfound" | "failed" };

const WINDOWS = [10, 20, 40] as const;

export function PlayerDeepDive({ athleteId, gameId }: { athleteId: string; gameId: string | null }) {
  const { lang, sport } = useNavState();
  const c = PLAYER_COPY[lang];
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [marketKey, setMarketKey] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, number>>({});
  const [side, setSide] = useState<"over" | "under">("over");
  const [windowSize, setWindowSize] = useState<(typeof WINDOWS)[number]>(20);

  useEffect(() => {
    const qs = new URLSearchParams({ sport: sport.key, lang, ...(gameId ? { game: gameId } : {}) });
    let alive = true;
    // Deferred so the effect itself sets no state synchronously.
    const id = setTimeout(() => {
      fetch(`/api/player/${athleteId}?${qs}`, { cache: "no-store" })
        .then(async (r) => {
          if (!alive) return;
          if (r.ok) return setLoad({ state: "ok", data: await r.json() });
          setLoad({ state: "error", code: r.status === 401 ? "signin" : r.status === 403 ? "cap" : r.status === 404 ? "notfound" : "failed" });
        })
        .catch(() => alive && setLoad({ state: "error", code: "failed" }));
    }, 0);
    return () => { alive = false; clearTimeout(id); };
  }, [athleteId, gameId, sport.key, lang]);

  const profile = load.state === "ok" ? load.data.profile : null;
  const market = profile ? profile.markets.find((m) => m.key === marketKey) ?? profile.markets.find((m) => m.posted.length) ?? profile.markets[0] : null;
  const line = market ? lines[market.key] ?? market.defaultLine : 0.5;
  const range = useMemo(() => (profile && market ? lineRange(profile.games, market.statLabels) : { min: 0.5, max: 10 }), [profile, market]);
  const table = useMemo(() => (profile && market ? rateTable(profile.games, market.statLabels, line, side) : null), [profile, market, line, side]);
  const bars = useMemo(() => {
    if (!profile || !market) return [];
    return profile.games.slice(0, windowSize).map((g) => {
      const value = gameTotal(g, market.statLabels);
      return { value: Number.isFinite(value) ? value : 0, label: `${g.homeAway === "@" ? "@" : ""}${g.opponent}`.slice(0, 5), title: `${g.date ? formatDate(g.date, lang) : ""} ${g.homeAway} ${g.opponent}: ${Number.isFinite(value) ? value : "—"}` };
    }).reverse();
  }, [profile, market, windowSize, lang]);

  if (load.state === "loading") return <PanelSkeleton rows={8} />;
  if (load.state === "error") {
    const back = gameId ? <Link href={{ pathname: `/app/game/${gameId}`, query: { sport: sport.key, lang } }} className="text-tiny text-fg-dim hover:text-fg-muted">{c.back}</Link> : null;
    if (load.code === "cap") {
      return (
        <div className="flex flex-col gap-3">
          {back}
          <section className="rounded-panel border border-warn bg-warn-tint p-5" data-testid="player-cap">
            <h1 className="text-base font-semibold text-fg">{c.capTitle}</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{c.capBody}</p>
            <div className="mt-3"><PlansLink lang={lang} label={c.seePlans} /></div>
          </section>
        </div>
      );
    }
    const msg = load.code === "signin" ? c.signIn : load.code === "notfound" ? c.notFound : c.failed;
    return (
      <div className="flex flex-col gap-4">
        {back}
        <PageHead kicker={c.title} title={c.notFoundTitle} actions={load.code === "signin" ? <LinkButton href={`/login?lang=${lang}`} variant="primary">{c.signInCta}</LinkButton> : undefined} />
        <Empty>{msg}</Empty>
      </div>
    );
  }
  if (!profile || !market || !table) return null;
  const setLine = (n: number) => setLines((prev) => ({ ...prev, [market.key]: Math.round(n * 2) / 2 }));
  const step = (d: number) => setLine(Math.min(range.max, Math.max(range.min, line + d)));

  return (
    <div className="flex flex-col gap-4">
      {profile.game && (
        <Link href={{ pathname: `/app/game/${profile.game.id}`, query: { sport: profile.sportKey, lang } }} className="w-fit text-tiny text-fg-dim hover:text-fg-muted max-md:inline-flex max-md:min-h-11 max-md:items-center">← {c.back}</Link>
      )}
      <PageHead
        kicker={c.title}
        title={<span data-testid="player-name">{profile.name}</span>}
        meta={[profile.teamAbbr, profile.position, profile.game ? `${profile.game.matchup} · ${formatDateTime(profile.game.startsAt, lang)}` : null].filter(Boolean).join(" · ")}
        actions={load.data.access.limit !== null ? <p className="text-label text-warn">{c.freeLeft}</p> : undefined}
      />

      <Panel title={c.market} lang={lang}>
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {profile.markets.map((m) => (
            <button key={m.key} type="button" onClick={() => setMarketKey(m.key)} data-testid={`market-${m.key}`} aria-pressed={m.key === market.key} className={chipClass(m.key === market.key)}>
              {m.label[lang]}{m.posted.length ? " •" : ""}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-control border border-line-control text-tiny">
            {(["over", "under"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSide(s)} aria-pressed={side === s} data-testid={`side-${s}`} className={`px-2.5 py-1 max-md:min-h-11 max-md:px-3 max-md:text-sm ${side === s ? "bg-surface-3 text-fg" : "text-fg-muted"}`}>{s === "over" ? c.over : c.under}</button>
            ))}
          </div>
          <button type="button" onClick={() => step(-0.5)} className="size-7 rounded-control border border-line-control text-fg max-md:size-11" aria-label="-0.5" data-testid="line-down">−</button>
          <span className="nums min-w-12 text-center text-base font-semibold text-warn" data-testid="line-value">{num(line, lang)}</span>
          <button type="button" onClick={() => step(0.5)} className="size-7 rounded-control border border-line-control text-fg max-md:size-11" aria-label="+0.5" data-testid="line-up">+</button>
          <input type="range" min={range.min} max={range.max} step={0.5} value={line} onChange={(e) => setLine(Number(e.target.value))} aria-label={c.line} className="range min-w-0 flex-1 max-md:order-last max-md:basis-full" />
        </div>
        <p className="mt-1 text-label text-fg-dim">{c.drag}</p>
        <div className="mt-3">
          <PlayerChart bars={bars} line={line} min={range.min} max={range.max} onLine={setLine} side={side} ariaLabel={c.line} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-label text-fg-dim">
          <span>{c.window}:</span>
          {WINDOWS.map((w) => (
            <button key={w} type="button" onClick={() => setWindowSize(w)} aria-pressed={windowSize === w} className={`u-hit rounded-control px-1.5 py-0.5 ${windowSize === w ? "bg-surface-3 text-fg" : "hover:text-fg-muted"}`}>{w === 10 ? c.last10 : w === 20 ? c.last20 : c.all}</button>
          ))}
        </div>
        <h2 className="mb-1.5 mt-4 text-micro u-label text-fg-dim">{c.rates}</h2>
        <RatesGrid table={table} c={c} lang={lang} />
        <p className="mt-1.5 text-label text-fg-dim">{c.push}</p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={c.posted} lang={lang}>
          <PostedLines market={market} lang={lang} c={c} onPick={(l, s) => { setLine(l); setSide(s); }} rateAtLine={(l, s) => rateAt(profile.games.map((g) => gameTotal(g, market.statLabels)), l, s)} />
        </Panel>
        <RoleCard profile={profile} lang={lang} c={c} />
        <DvpCard profile={profile} lang={lang} c={c} />
        <SplitCard profile={profile} market={market} line={line} side={side} lang={lang} c={c} />
      </div>

      <PlayerReadCard profile={profile} gameId={gameId} lang={lang} c={c} initial={{ read: load.data.read, price: load.data.readPrice, coins: load.data.coins, aiReady: load.data.aiReady }} />
      <p className="text-label text-fg-dim">{c.honesty}</p>
    </div>
  );
}
