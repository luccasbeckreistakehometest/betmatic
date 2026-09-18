"use client";

import { useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui";
import type { PlayerCopy } from "@/components/player-copy";
import { splitWithWithout, type Rate, type RateTable } from "@/lib/props/rates";
import type { PlayerMarketView, PlayerProfileView } from "@/lib/props/player-view";
import type { PlayerGame } from "@/lib/types";
import type { Lang } from "@/lib/i18n";

export const num = (n: number, lang: Lang, digits = 1) => (lang === "pt" ? n.toFixed(digits).replace(".", ",") : n.toFixed(digits));
const pctText = (r: Rate) => (r.of ? `${Math.round(r.pct * 100)}%` : "—");

export function RateCell({ label, rate, c }: { label: string; rate: Rate; c: PlayerCopy }) {
  const tone = !rate.of ? "text-fg-dim" : rate.pct >= 0.6 ? "text-pos" : rate.pct >= 0.45 ? "text-warn" : "text-neg";
  return (
    <div className="bg-surface-1 px-2 py-2 text-center">
      <div className="text-micro uppercase tracking-wider text-fg-dim">{label}</div>
      <div className={`nums text-base font-semibold ${tone}`}>{pctText(rate)}</div>
      <div className="nums text-micro text-fg-dim">{rate.of ? `${rate.hits}/${rate.of}` : c.noSample}</div>
    </div>
  );
}

export function RatesGrid({ table, c }: { table: RateTable; c: PlayerCopy }) {
  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-control border border-line bg-surface-3 sm:grid-cols-5" data-testid="player-rates">
      <RateCell label={c.l5} rate={table.last5} c={c} />
      <RateCell label={c.l10} rate={table.last10} c={c} />
      <RateCell label={c.season} rate={table.season} c={c} />
      <RateCell label={c.home} rate={table.home} c={c} />
      <RateCell label={c.away} rate={table.away} c={c} />
    </div>
  );
}

export function PostedLines({ market, lang, c, onPick, rateAtLine }: {
  market: PlayerMarketView; lang: Lang; c: PlayerCopy; onPick: (line: number, side: "over" | "under") => void;
  rateAtLine: (line: number, side: "over" | "under") => Rate;
}) {
  if (!market.posted.length) return <p className="text-tiny text-fg-dim" data-testid="posted-empty">{c.postedEmpty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-line" data-testid="posted-lines">
      {market.posted.map((p, i) => {
        const r = rateAtLine(p.line, p.side);
        return (
          <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-tiny">
            <span className="text-fg">{p.side === "over" ? c.over : c.under} {num(p.line, lang)}</span>
            <span className="nums text-fg-muted">{c.price} {num(p.decimal, lang, 2)}</span>
            {p.openDecimal !== null && Math.abs(p.openDecimal - p.decimal) >= 0.01 && <span className="nums text-label text-fg-dim">{c.opened} {num(p.openDecimal, lang, 2)}</span>}
            <span className="nums text-label text-fg-muted">{p.noVigFair !== null ? `${c.fair} ${Math.round(p.noVigFair * 100)}%` : c.oneSided}</span>
            <span className="nums text-label text-fg-muted">{c.measuredHere} {r.of ? `${r.hits}/${r.of}` : "—"}</span>
            <button type="button" onClick={() => onPick(p.line, p.side)} className="ml-auto rounded-control border border-line-strong px-2 py-0.5 text-label text-fg-muted hover:border-pos hover:text-fg">{c.useLine}</button>
          </li>
        );
      })}
    </ul>
  );
}

export function RoleCard({ profile, lang, c }: { profile: PlayerProfileView; lang: Lang; c: PlayerCopy }) {
  const role = profile.role;
  const minutes = profile.games.map((g) => Number(g.stats.MIN)).filter(Number.isFinite).slice(0, 10).reverse();
  const top = Math.max(1, ...minutes);
  return (
    <Panel title={c.role} lang={lang}>
      {role ? (
        <div className="flex flex-col gap-2 text-tiny" data-testid="player-role">
          <p><span className="rounded-control bg-surface-3 px-1.5 py-0.5 text-label font-semibold text-fg">{c.tier[role.tier]}</span></p>
          {role.recentMinutes !== null && role.minutesPerGame !== null ? (
            <p className="nums text-fg-muted">{num(role.recentMinutes, lang, 0)} {c.minutes} · {c.avg} {num(role.minutesPerGame, lang, 0)}{Math.abs(role.minutesTrend) >= 1 ? ` · ${c.trend} ${role.minutesTrend > 0 ? "+" : ""}${num(role.minutesTrend, lang)}` : ""}</p>
          ) : (
            <p className="nums text-fg-muted">{c.starts}: {Math.round(role.reliability * 100)}% · {role.note}</p>
          )}
          {minutes.length > 2 && (
            <div className="flex h-10 items-end gap-0.5" aria-hidden>
              {minutes.map((m, i) => <span key={i} className="flex-1 rounded-control bg-action" style={{ height: `${Math.max(6, (m / top) * 100)}%` }} />)}
            </div>
          )}
          {profile.sportGroup === "soccer" && <p className="text-label text-fg-dim">{c.noMinutes}</p>}
        </div>
      ) : (
        <p className="text-tiny text-fg-dim">{c.tier.unknown}</p>
      )}
    </Panel>
  );
}

export function DvpCard({ profile, lang, c }: { profile: PlayerProfileView; lang: Lang; c: PlayerCopy }) {
  if (profile.sportGroup !== "basketball") return null;
  const d = profile.dvp;
  return (
    <Panel title={c.dvp} lang={lang}>
      {d ? (
        <div className="text-tiny" data-testid="player-dvp">
          <p className="text-fg-muted">{c.dvpBody.replace("{pos}", d.position).replace("{team}", d.opponent).replace("{n}", String(d.games))}</p>
          <p className="nums mt-1.5 text-fg">{num(d.opponentConcedes.points, lang)} {c.pts} · {num(d.opponentConcedes.rebounds, lang)} {c.reb} · {num(d.opponentConcedes.assists, lang)} {c.ast} · {num(d.opponentConcedes.threes, lang)} {c.threes}</p>
          {d.ownConcedes && <p className="nums mt-1 text-label text-fg-dim">{c.dvpOwn} {num(d.ownConcedes.points, lang)} {c.pts}</p>}
        </div>
      ) : (
        <p className="text-tiny text-fg-dim">{c.dvpNone}</p>
      )}
    </Panel>
  );
}

export function SplitCard({ profile, market, line, side, lang, c }: { profile: PlayerProfileView; market: PlayerMarketView; line: number; side: "over" | "under"; lang: Lang; c: PlayerCopy }) {
  const [mate, setMate] = useState("");
  const [log, setLog] = useState<{ id: string; games: Pick<PlayerGame, "eventId" | "stats">[] } | null>(null);
  const [busy, setBusy] = useState(false);
  async function pick(id: string) {
    setMate(id);
    if (!id) { setLog(null); return; }
    setBusy(true);
    const r = await fetch(`/api/player/${profile.athleteId}/teammate?sport=${profile.sportKey}&mate=${id}&lang=${lang}`, { cache: "no-store" }).catch(() => null);
    const j = r?.ok ? await r.json() : { games: [] };
    setLog({ id, games: j.games ?? [] });
    setBusy(false);
  }
  const split = log && log.id === mate ? splitWithWithout(profile.games, log.games, market.statLabels, line, side, profile.usesMinutes) : null;
  const mateName = profile.teammates.find((t) => t.id === mate)?.name ?? "";
  return (
    <Panel title={c.split} lang={lang}>
      <p className="text-tiny text-fg-muted">{c.splitHint}</p>
      <select value={mate} onChange={(e) => void pick(e.target.value)} className="mt-2 w-full rounded-control border border-line-strong bg-surface-1 px-2 py-1.5 text-tiny text-fg" data-testid="split-mate" aria-label={c.split}>
        <option value="">{c.pick}</option>
        {profile.teammates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {busy && <p className="mt-2 text-tiny text-fg-dim">{c.splitLoading}</p>}
      {split && !busy && (split.enough ? (
        <div className="mt-2" data-testid="split-result">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-control border border-line bg-surface-3">
            <RateCell label={`${c.with} ${mateName.split(" ")[0]} · ${split.withGames} ${c.games}`} rate={split.with} c={c} />
            <RateCell label={`${c.without} · ${split.withoutGames} ${c.games}`} rate={split.without} c={c} />
          </div>
          <p className="mt-1.5 text-label text-warn/90">{c.splitNote}</p>
        </div>
      ) : (
        <p className="mt-2 text-tiny text-warn" data-testid="split-small">{c.small} ({c.with}: {split.withGames} · {c.without}: {split.withoutGames})</p>
      ))}
    </Panel>
  );
}

export function PlansLink({ lang, label }: { lang: Lang; label: string }) {
  return <Link href={{ pathname: "/planos", query: { lang } }} className="rounded-control bg-action px-3 py-1.5 text-tiny font-semibold text-action-fg hover:bg-action">{label}</Link>;
}
