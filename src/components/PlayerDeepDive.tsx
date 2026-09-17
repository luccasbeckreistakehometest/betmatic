"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useNavState } from "@/components/Controls";
import { Panel } from "@/components/ui";
import { PlayerChart } from "@/components/PlayerChart";
import { PLAYER_COPY } from "@/components/player-copy";
import { DvpCard, num, PlansLink, PostedLines, RatesGrid, RoleCard, SplitCard } from "@/components/PlayerPanels";
import { PlayerReadCard, type ReadState } from "@/components/PlayerReadCard";
import { gameTotal, rateAt, rateTable } from "@/lib/props/rates";
import { lineRange, type PlayerProfileView } from "@/lib/props/player-view";
import { formatDate, formatDateTime } from "@/lib/format";

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

  if (load.state === "loading") return <div className="h-60 animate-pulse rounded-xl bg-ink-900" aria-label={c.loading} />;
  if (load.state === "error") {
    const back = gameId ? <Link href={{ pathname: `/app/game/${gameId}`, query: { sport: sport.key, lang } }} className="text-[12px] text-mist-500 hover:text-mist-300">{c.back}</Link> : null;
    if (load.code === "cap") {
      return (
        <div className="flex flex-col gap-3">
          {back}
          <section className="rounded-xl border border-warn-400/30 bg-warn-400/[0.06] p-5" data-testid="player-cap">
            <h1 className="text-[15px] font-semibold text-mist-100">{c.capTitle}</h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-mist-300">{c.capBody}</p>
            <div className="mt-3"><PlansLink lang={lang} label={c.seePlans} /></div>
          </section>
        </div>
      );
    }
    const msg = load.code === "signin" ? c.signIn : load.code === "notfound" ? c.notFound : c.failed;
    return <div className="flex flex-col gap-3">{back}<p className="text-[13px] text-mist-400" data-testid="player-error">{msg}</p></div>;
  }
  if (!profile || !market || !table) return null;
  const setLine = (n: number) => setLines((prev) => ({ ...prev, [market.key]: Math.round(n * 2) / 2 }));
  const step = (d: number) => setLine(Math.min(range.max, Math.max(range.min, line + d)));

  return (
    <div className="flex flex-col gap-4">
      {profile.game && (
        <Link href={{ pathname: `/app/game/${profile.game.id}`, query: { sport: profile.sportKey, lang } }} className="w-fit text-[12px] text-mist-500 hover:text-mist-300">← {c.back}</Link>
      )}
      <header className="rounded-xl border border-ink-800 bg-ink-900/60 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-edge-400">{c.title}</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-white" data-testid="player-name">{profile.name}</h1>
        <p className="text-[12px] text-mist-500">{[profile.teamAbbr, profile.position, profile.game ? `${profile.game.matchup} · ${formatDateTime(profile.game.startsAt, lang)}` : null].filter(Boolean).join(" · ")}</p>
        {load.data.access.limit !== null && <p className="mt-1.5 text-[11px] text-warn-400/90">{c.freeLeft}</p>}
      </header>

      <Panel title={c.market} lang={lang}>
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {profile.markets.map((m) => (
            <button key={m.key} type="button" onClick={() => setMarketKey(m.key)} data-testid={`market-${m.key}`} aria-pressed={m.key === market.key}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] ${m.key === market.key ? "border-edge-400 bg-edge-400/10 text-mist-100" : "border-ink-700 text-mist-400 hover:text-mist-100"}`}>
              {m.label[lang]}{m.posted.length ? " •" : ""}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-ink-700 text-[12px]">
            {(["over", "under"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSide(s)} aria-pressed={side === s} data-testid={`side-${s}`} className={`px-2.5 py-1 ${side === s ? "bg-ink-700 text-mist-100" : "text-mist-400"}`}>{s === "over" ? c.over : c.under}</button>
            ))}
          </div>
          <button type="button" onClick={() => step(-0.5)} className="size-7 rounded-lg border border-ink-700 text-mist-200" aria-label="-0.5" data-testid="line-down">−</button>
          <span className="nums min-w-12 text-center text-[15px] font-semibold text-warn-400" data-testid="line-value">{num(line, lang)}</span>
          <button type="button" onClick={() => step(0.5)} className="size-7 rounded-lg border border-ink-700 text-mist-200" aria-label="+0.5" data-testid="line-up">+</button>
          <input type="range" min={range.min} max={range.max} step={0.5} value={line} onChange={(e) => setLine(Number(e.target.value))} aria-label={c.line} className="min-w-0 flex-1 accent-amber-400" />
        </div>
        <p className="mt-1 text-[11px] text-mist-500">{c.drag}</p>
        <div className="mt-3">
          <PlayerChart bars={bars} line={line} min={range.min} max={range.max} onLine={setLine} side={side} ariaLabel={c.line} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-mist-500">
          <span>{c.window}:</span>
          {WINDOWS.map((w) => (
            <button key={w} type="button" onClick={() => setWindowSize(w)} aria-pressed={windowSize === w} className={`rounded px-1.5 py-0.5 ${windowSize === w ? "bg-ink-700 text-mist-100" : "hover:text-mist-300"}`}>{w === 10 ? c.last10 : w === 20 ? c.last20 : c.all}</button>
          ))}
        </div>
        <h2 className="mb-1.5 mt-4 text-[10px] font-semibold uppercase tracking-wider text-mist-500">{c.rates}</h2>
        <RatesGrid table={table} c={c} />
        <p className="mt-1.5 text-[11px] text-mist-500">{c.push}</p>
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
      <p className="text-[11px] text-mist-500">{c.honesty}</p>
    </div>
  );
}
