"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useNavState } from "@/components/Controls";
import { Checkbox, Empty, Odds, PageHead, Panel, Select, buttonClass, chipClass } from "@/components/ui";
import { formatDecimal } from "@/lib/odds";
import { formatPercent as pctOf } from "@/lib/format";
import { formatOdds } from "@/lib/format";
import type { CustomTicketView } from "@/lib/bets/custom-writeup";
import type { Lang } from "@/lib/i18n";

interface Meta {
  signedIn: boolean; coins: number; price: number; aiReady: boolean;
  markets: { key: string; label: { pt: string; en: string } }[];
}
interface SlateGame { id: string; status: string; startsAt: string; home: { displayName: string }; away: { displayName: string } }
interface Result {
  reachable: boolean; nearest: number | null; reason: string; tickets: CustomTicketView[]; slipId?: string;
  coinsSpent: number; balance: number; cached?: boolean; aiWritten?: boolean; message?: string; error?: string;
}

const PRESETS = [5, 20, 100];

const C = {
  pt: {
    kicker: "Múltiplas", title: "Múltipla sob medida", sub: "Você diz quanto quer que pague; a gente procura, entre as pernas com preço e histórico de hoje, a combinação com mais chance de bater perto desse número — uma perna por jogo. Se não der, a gente fala.",
    target: "Quanto quer que pague", legs: "Máximo de pernas", markets: "Mercados", allMarkets: "todos", games: "Jogos (opcional)", allGames: "todos os jogos de hoje",
    measured: "Só pernas com histórico medido", minRate: "Acerto mínimo de cada perna", build: "Montar", coins: "coins", noCoins: "Coins insuficientes para montar.", buy: "Comprar coins",
    signIn: "Entre na sua conta para montar a sua múltipla.", running: "Procurando a melhor combinação…", unreachable: "Não dá para chegar em {target} com as pernas de hoje. O mais perto: {nearest}. Os coins voltaram para você.",
    empty: "Nenhuma perna de hoje passa nesses filtros. Afrouxe o acerto mínimo ou os mercados. Os coins voltaram.", chance: "chance estimada", implied: "chance da casa", ev: "EV",
    stake: "Valor", save: "Salvar na banca", saved: "Salvo na banca ✓", limit: "Passa do seu teto de aposta.", paused: "Sua pausa está ativa.",
    honesty: "Chance estimada vem do histórico medido de cada perna (puxado um pouco para o preço da casa). Múltipla longa perde na maioria das vezes.",
    template: "Explicação automática (sem IA).", cached: "mesmo cálculo de minutos atrás, sem gastar IA de novo", spent: "gastou", failed: "Não deu para montar agora. Os coins voltaram.",
  },
  en: {
    kicker: "Parlays", title: "Custom parlay", sub: "Tell us the payout you want; we search today's priced, measured legs for the combination most likely to land near it — one leg per game. If it can't be done, we say so.",
    target: "Target payout", legs: "Max legs", markets: "Markets", allMarkets: "all", games: "Games (optional)", allGames: "all of today's games",
    measured: "Only legs with a measured record", minRate: "Minimum hit rate per leg", build: "Build", coins: "coins", noCoins: "Not enough coins to build.", buy: "Buy coins",
    signIn: "Log in to build your parlay.", running: "Searching for the best combination…", unreachable: "{target} can't be reached with today's legs. The closest: {nearest}. Your coins are back.",
    empty: "No leg today passes these filters. Loosen the minimum rate or the markets. Your coins are back.", chance: "modelled chance", implied: "book's chance", ev: "EV",
    stake: "Stake", save: "Save to bankroll", saved: "Saved to bankroll ✓", limit: "Over your stake ceiling.", paused: "Your pause is active.",
    honesty: "The modelled chance comes from each leg's measured record (pulled slightly toward the book's price). Long parlays lose most of the time.",
    template: "Automatic explanation (no AI).", cached: "same calculation as a few minutes ago, no new AI spend", spent: "spent", failed: "Couldn't build it right now. Your coins are back.",
  },
};

export function CustomParlay() {
  const { lang, sport } = useNavState();
  const c = C[lang];
  const [meta, setMeta] = useState<Meta | null>(null);
  const [games, setGames] = useState<SlateGame[]>([]);
  const [target, setTarget] = useState(20);
  const [maxLegs, setMaxLegs] = useState(4);
  const [markets, setMarkets] = useState<string[]>([]);
  const [gameIds, setGameIds] = useState<string[]>([]);
  const [measuredOnly, setMeasuredOnly] = useState(true);
  const [minRate, setMinRate] = useState(55);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const load = useCallback(async () => {
    const [m, s] = await Promise.all([
      fetch(`/api/parlays/custom?sport=${sport.key}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/slate?sport=${sport.key}&lang=${lang}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    setMeta(m);
    setGames(((s?.games ?? []) as SlateGame[]).filter((g) => g.status === "scheduled" && Date.parse(g.startsAt) > Date.now()));
  }, [sport.key, lang]);
  useEffect(() => { void (async () => { await Promise.resolve(); await load(); })(); }, [load]);

  async function build() {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/parlays/custom", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sport: sport.key, lang, target, maxLegs, markets, gameIds, measuredOnly, minRate: minRate / 100 }),
      });
      const j = await r.json().catch(() => ({ error: "failed" }));
      setResult(r.ok ? j : { ...j, reachable: false, tickets: [], nearest: null, reason: j.error ?? "failed", coinsSpent: 0, balance: meta?.coins ?? 0 });
      if (r.ok) setMeta((m) => (m ? { ...m, coins: j.balance } : m));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  const canAfford = !!meta && meta.coins >= meta.price;

  return (
    <div className="flex flex-col gap-5">
      <PageHead kicker={c.kicker} title={c.title} meta={c.sub} actions={<span className="text-label u-label text-fg-dim">{sport.label[lang]}</span>} />
      <CustomForm
        c={c} lang={lang} meta={meta} games={games} busy={busy} canAfford={canAfford}
        state={{ target, maxLegs, markets, gameIds, measuredOnly, minRate }}
        set={{ setTarget, setMaxLegs, setMeasuredOnly, setMinRate, toggleMarket: (k) => setMarkets((m) => toggle(m, k)), toggleGame: (k) => setGameIds((g) => toggle(g, k)) }}
        onBuild={() => void build()}
      />
      {busy && <Empty>{c.running}</Empty>}
      {result && <CustomResults c={c} lang={lang} result={result} target={target} />}
    </div>
  );
}

type Copy = (typeof C)["pt"];

function CustomForm(props: {
  c: Copy; lang: "pt" | "en"; meta: Meta | null; games: SlateGame[]; busy: boolean; canAfford: boolean;
  state: { target: number; maxLegs: number; markets: string[]; gameIds: string[]; measuredOnly: boolean; minRate: number };
  set: { setTarget: (n: number) => void; setMaxLegs: (n: number) => void; setMeasuredOnly: (b: boolean) => void; setMinRate: (n: number) => void; toggleMarket: (k: string) => void; toggleGame: (k: string) => void };
  onBuild: () => void;
}) {
  const { c, lang, meta, games, state, set } = props;
  if (meta && !meta.signedIn) {
    return <Panel title={c.title}><div className="flex flex-col gap-2"><Empty>{c.signIn}</Empty><Link href={`/login?lang=${lang}`} className={buttonClass("primary", "w-fit")}>{lang === "pt" ? "Entrar" : "Log in"}</Link></div></Panel>;
  }
  // Selection is achromatic, exactly like the primary button: a chip is not a hue (§6.2).
  const chip = (on: boolean) => chipClass(on);
  return (
    <Panel title={c.target}>
      <div className="flex max-w-[56rem] flex-col gap-5" data-testid="custom-form">
        {/* Presets, the slider and the exact number: on a phone the slider takes its own full row. */}
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => <button key={p} type="button" onClick={() => set.setTarget(p)} aria-pressed={state.target === p} className={chip(state.target === p)} data-testid={`preset-${p}`}>{p}x</button>)}
          <input type="range" min={2} max={500} step={1} value={state.target} onChange={(e) => set.setTarget(Number(e.target.value))} aria-label={c.target} className="range min-w-0 flex-1 max-md:order-last max-md:basis-full" />
          <input type="number" inputMode="numeric" min={2} max={500} value={state.target} onChange={(e) => set.setTarget(Math.min(500, Math.max(2, Number(e.target.value) || 2)))} aria-label={c.target} className={buttonClass("secondary", "w-20 nums max-md:ml-auto")} data-testid="target-input" />
        </div>
        <label className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          {c.legs}
          <Select value={state.maxLegs} onChange={(e) => set.setMaxLegs(Number(e.target.value))} >
            {[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </label>
        <div>
          <p className="text-label u-label text-fg-dim">{c.markets} <span className="normal-case tracking-normal">({state.markets.length ? state.markets.length : c.allMarkets})</span></p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(meta?.markets ?? []).map((m) => <button key={m.key} type="button" onClick={() => set.toggleMarket(m.key)} aria-pressed={state.markets.includes(m.key)} className={chip(state.markets.includes(m.key))}>{m.label[lang]}</button>)}
          </div>
        </div>
        {games.length > 0 && (
          <div>
            <p className="text-label u-label text-fg-dim">{c.games} <span className="normal-case tracking-normal">({state.gameIds.length ? state.gameIds.length : c.allGames})</span></p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {games.map((g) => <button key={g.id} type="button" onClick={() => set.toggleGame(g.id)} aria-pressed={state.gameIds.includes(g.id)} className={chip(state.gameIds.includes(g.id))}>{g.away.displayName} @ {g.home.displayName}</button>)}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-4 text-sm text-fg-muted">
          <Checkbox checked={state.measuredOnly} onChange={(e) => set.setMeasuredOnly(e.target.checked)} label={c.measured} />
          <label className="flex items-center gap-2 max-md:basis-full">{c.minRate} <input type="range" min={40} max={80} value={state.minRate} onChange={(e) => set.setMinRate(Number(e.target.value))} aria-label={c.minRate} className="range w-32 max-md:min-w-0 max-md:flex-1" /><span className="nums w-12 text-right text-fg">{pctOf(state.minRate / 100, lang, { digits: 0 })}</span></label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={props.onBuild} disabled={props.busy || !props.canAfford} className={buttonClass("primary")} data-testid="custom-build">
            {c.build} · {meta?.price ?? "…"} {c.coins}
          </button>
          {meta && !props.canAfford && <span className="text-tiny text-warn">{c.noCoins} <Link href={`/planos?lang=${lang}`} className="underline">{c.buy}</Link></span>}
          {meta && <span className="nums text-tiny text-fg-dim">{meta.coins} {c.coins}</span>}
        </div>
        <p className="text-tiny text-fg-dim">{c.honesty}</p>
      </div>
    </Panel>
  );
}

function CustomResults({ c, lang, result, target }: { c: Copy; lang: Lang; result: Result; target: number }) {
  if (!result.reachable) {
    const text = result.reason === "empty_pool" ? c.empty
      : result.reason === "too_high" || result.reason === "too_low"
        ? c.unreachable.replace("{target}", `${target}x`).replace("{nearest}", result.nearest ? formatDecimal(result.nearest, lang) : "—")
        : result.message ?? c.failed;
    return <p className="border-l-2 border-warn bg-warn-tint px-3 py-2 text-sm text-warn" data-testid="custom-unreachable">{text}</p>;
  }
  return (
    <div className="flex flex-col gap-3" data-testid="custom-results">
      <p className="text-tiny text-fg-dim">
        {c.spent} <span className="nums">{result.coinsSpent}</span> {c.coins}{result.cached ? ` · ${c.cached}` : ""}{result.aiWritten === false ? ` · ${c.template}` : ""}
      </p>
      {result.tickets.map((t, i) => <CustomTicket key={i} c={c} lang={lang} ticket={t} index={i} slipId={result.slipId} />)}
    </div>
  );
}

function CustomTicket({ c, lang, ticket, index, slipId }: { c: Copy; lang: Lang; ticket: CustomTicketView; index: number; slipId?: string }) {
  const [stake, setStake] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "limit" | "paused" | "error">("idle");
  async function save() {
    setState("saving");
    const r = await fetch("/api/bankroll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "custom", slipId, ticketIndex: index, stake: Number(stake) }) });
    setState(r.ok ? "saved" : r.status === 422 ? "limit" : r.status === 423 ? "paused" : "error");
  }
  return (
    <article className="rounded-panel border border-line bg-surface-1" data-testid="custom-ticket">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
        <span className="text-sm font-semibold text-fg">{ticket.title}</span>
        <span className="ml-auto"><Odds decimal={ticket.decimal} probability={ticket.fairProbability} lang={lang} className="text-sm" /></span>
      </header>
      <div className="px-3.5 py-3">
        <p className="text-tiny leading-relaxed text-fg-muted">{ticket.background}</p>
        <ol className="mt-2.5 flex flex-col border-t border-line">
          {ticket.legs.map((l) => (
            <li key={l.key} className="border-b border-line py-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-tiny font-medium text-fg">{l.selection}</span>
                <span className="nums text-tiny text-fg-muted">{formatOdds(l.decimal, lang)}</span>
                <span className="text-label text-fg-dim">{l.matchup}</span>
                <span className="nums ml-auto text-micro text-fg-dim">{pctOf(l.fairProbability, lang, { digits: 0 })}</span>
              </div>
              {l.note && <p className="mt-0.5 text-tiny text-fg-dim">{l.note}</p>}
            </li>
          ))}
        </ol>
        <div className="mt-2.5 grid grid-cols-3 gap-x-6 gap-y-3 border-y border-line py-2.5">
          {[[c.chance, pctOf(ticket.fairProbability, lang, { digits: 2 })], [c.implied, pctOf(ticket.impliedProbability, lang, { digits: 2 })], [c.ev, pctOf(ticket.ev, lang, { signed: true })]].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-1"><span className="text-micro u-label text-fg-dim">{k}</span><span className="nums text-sm text-fg">{v}</span></div>
          ))}
        </div>
        <p className="mt-2.5 border-l-2 border-warn pl-2.5 text-tiny text-warn">{ticket.riskNote}</p>
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-2.5 text-tiny">
        {state === "saved" ? <span className="text-pos" data-testid="custom-saved">{c.saved}</span> : (
          <>
            <input value={stake} onChange={(e) => setStake(e.target.value)} placeholder={c.stake} inputMode="decimal" enterKeyHint="done" aria-label={c.stake} className={buttonClass("secondary", "w-20 nums max-md:w-auto max-md:min-w-0 max-md:flex-1 max-md:text-right")} data-testid="custom-stake" />
            <button type="button" onClick={() => void save()} disabled={!(Number(stake) > 0) || state === "saving" || !slipId} className={buttonClass("secondary", "max-md:flex-1")} data-testid="custom-save">{c.save}</button>
            {state === "limit" && <span className="text-warn">{c.limit}</span>}
            {state === "paused" && <span className="text-warn">{c.paused}</span>}
            {state === "error" && <span className="text-warn">{c.failed}</span>}
          </>
        )}
      </footer>
    </article>
  );
}
