"use client";

import { track } from "@/lib/track";
import { useEffect, useRef, useState } from "react";
import { formatDecimal, formatPercent } from "@/lib/odds";
import { formatTime } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import type { BetSlate } from "@/lib/types";

interface Leg { selection: string; state: "won" | "lost" | "alive" | "unknown"; probability: number | null; reason: string; flags: string[] }
interface Ticket { id: string; title: string; source: "served" | "saved"; preChance: number | null; chanceNow: number | null; legs: Leg[] }
interface Payload {
  paused?: boolean;
  snapshot: { state: "pre" | "in" | "post"; clock: string; period: number; home: { abbr: string; score: number }; away: { abbr: string; score: number } } | null;
  tickets: Ticket[];
  read: { slate: BetSlate; generatedAt: string; minute: number } | null;
  canRead: boolean;
  nextReadAt: string | null;
}

const POLL_MS = Number(process.env.NEXT_PUBLIC_LIVE_POLL_MS) || 60_000;

const C = {
  pt: {
    title: "Ao vivo", caution: "Ao vivo a casa ajusta rápido; a leitura pode já estar velha. Aposte só o que não faz falta.",
    empty: "Nenhum bilhete deste jogo para acompanhar.", before: "chance antes", now: "chance agora", won: "bateu", lost: "caiu", alive: "vivo", unknown: "sem leitura",
    saved: "seu bilhete", served: "bilhete do jogo", foul: "5 faltas", benched: "no banco", final: "Jogo encerrado — os bilhetes são liquidados em seguida.",
    read: "Leitura ao vivo", readBtn: "Pedir leitura ao vivo", readBusy: "Lendo o jogo…", readAt: "leitura do minuto {m} · {t}", readNext: "Nova leitura liberada às {t}.",
    readPlan: "A leitura ao vivo faz parte dos planos Pro e Max.", readFail: "Não deu para ler o jogo agora.", updated: "atualizado {t}",
  },
  en: {
    title: "Live", caution: "Books adjust fast in play; the read may already be stale. Only bet what you can afford to lose.",
    empty: "No ticket on this game to follow.", before: "chance before", now: "chance now", won: "cleared", lost: "busted", alive: "alive", unknown: "no read",
    saved: "your ticket", served: "game ticket", foul: "5 fouls", benched: "benched", final: "Game over — tickets are graded next.",
    read: "Live read", readBtn: "Ask for a live read", readBusy: "Reading the game…", readAt: "read at minute {m} · {t}", readNext: "A new read unlocks at {t}.",
    readPlan: "The live read is part of the Pro and Max plans.", readFail: "Couldn't read the game right now.", updated: "updated {t}",
  },
};

const CHIP: Record<Leg["state"], string> = {
  won: "bg-edge-400/15 text-edge-400", lost: "bg-alert-400/15 text-alert-400", alive: "bg-signal-500/15 text-signal-400", unknown: "bg-ink-800 text-mist-500",
};

/**
 * Follows a game in play: every leg of its tickets (and of the viewer's saved ones) with the chance
 * left. Polls once a minute, only while the tab is visible, and stops at full time. No countdowns,
 * no calls to action: a fixed caution note sits on top.
 */
export function LivePanel({ gameId, sportKey, dateKey, lang }: { gameId: string; sportKey: string; dateKey: string; lang: Lang }) {
  const c = C[lang];
  const [data, setData] = useState<Payload | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const done = useRef(false);
  const opened = useRef(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (done.current || document.visibilityState !== "visible") return;
      const r = await fetch(`/api/game/${gameId}/live?sport=${sportKey}&lang=${lang}&date=${dateKey}`, { cache: "no-store" }).catch(() => null);
      if (!alive || !r?.ok) return;
      const j = (await r.json()) as Payload;
      if (j.snapshot?.state === "post") done.current = true;
      if (!opened.current && j.snapshot) { opened.current = true; track("live_panel_open", { state: j.snapshot.state }); }
      setData(j);
      setUpdatedAt(new Date().toISOString());
    };
    const first = setTimeout(() => void tick(), 0);
    const timer = setInterval(() => void tick(), POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [gameId, sportKey, lang, dateKey]);

  async function askRead() {
    setBusy(true);
    setNote(null);
    const r = await fetch(`/api/game/${gameId}/live?sport=${sportKey}&lang=${lang}&date=${dateKey}`, { method: "POST" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (r?.ok) {
      setData((d) => (d ? { ...d, read: j.read, nextReadAt: j.nextReadAt } : d));
      setUpdatedAt(new Date().toISOString());
    }
    else setNote(j.message ?? c.readFail);
  }

  if (!data || data.paused || !data.snapshot) return null;
  const s = data.snapshot;
  // Compared with the time of the last fetch, not the clock, so rendering stays pure.
  const cooling = !!data.nextReadAt && !!updatedAt && Date.parse(data.nextReadAt) > Date.parse(updatedAt);
  return (
    <section className="rounded-xl border border-signal-500/30 bg-ink-900/70" data-testid="live-panel" data-live-url={`/api/game/${gameId}/live?sport=${sportKey}&lang=${lang}&date=${dateKey}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-ink-800 px-4 py-2.5">
        <span className={`size-2 rounded-full ${s.state === "in" ? "animate-pulse bg-alert-400" : "bg-mist-500"}`} aria-hidden />
        <h2 className="text-[13px] font-semibold text-mist-100">{c.title}</h2>
        <span className="nums text-[13px] text-mist-200" data-testid="live-score">{s.away.abbr} {s.away.score} × {s.home.score} {s.home.abbr}</span>
        <span className="nums text-[11px] text-mist-500">{s.clock}</span>
        {updatedAt && <span className="ml-auto text-[10.5px] text-mist-600">{c.updated.replace("{t}", formatTime(updatedAt, lang))}</span>}
      </header>
      <div className="flex flex-col gap-3 px-4 py-3">
        <p className="rounded-lg border border-warn-400/25 bg-warn-400/5 px-3 py-2 text-[12px] text-warn-400" data-testid="live-caution">{c.caution}</p>
        {s.state === "post" && <p className="text-[12px] text-mist-400">{c.final}</p>}
        {data.tickets.length === 0 ? <p className="text-[12.5px] text-mist-500">{c.empty}</p> : (
          <ul className="flex flex-col gap-2.5">
            {data.tickets.map((t) => (
              <li key={t.id} className="rounded-lg border border-ink-800 bg-ink-850/50 p-3" data-testid="live-ticket">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[12.5px] font-semibold text-mist-100">{t.title}</span>
                  <span className="text-[10px] uppercase tracking-wide text-mist-500">{t.source === "saved" ? c.saved : c.served}</span>
                  <span className="nums ml-auto text-[11.5px] text-mist-400" data-testid="live-chance">
                    {t.preChance !== null && <>{c.before} {formatPercent(t.preChance, 0)} · </>}{c.now} <span className="text-mist-100">{t.chanceNow === null ? "—" : formatPercent(t.chanceNow, 0)}</span>
                  </span>
                </div>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {t.legs.map((l, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-2 text-[12px]">
                      <span className={`nums rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${CHIP[l.state]}`} data-testid="live-chip">
                        {l.state === "alive" && l.probability !== null ? `${c.alive} ${formatPercent(l.probability, 0)}` : c[l.state]}
                      </span>
                      <span className="text-mist-200">{l.selection}</span>
                      {l.flags.includes("foul_trouble") && <span className="rounded bg-warn-400/15 px-1 text-[10px] text-warn-400" data-testid="live-foul">{c.foul}</span>}
                      {l.flags.includes("benched") && <span className="rounded bg-warn-400/15 px-1 text-[10px] text-warn-400">{c.benched}</span>}
                      <span className="basis-full pl-1 text-[11px] text-mist-500">{l.reason}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-ink-800 pt-3" data-testid="live-read">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-mist-500">{c.read}</h3>
          {data.read && (
            <div className="mt-1.5">
              <p className="text-[11px] text-mist-500">{c.readAt.replace("{m}", String(data.read.minute)).replace("{t}", formatTime(data.read.generatedAt, lang))}</p>
              <ul className="mt-1 flex flex-col gap-1.5">
                {data.read.slate.suggestions.map((sug) => (
                  <li key={sug.id} className="rounded border border-ink-800 px-2.5 py-1.5 text-[12px]" data-testid="live-read-ticket">
                    <span className="font-medium text-mist-100">{sug.title}</span> <span className="nums text-signal-400">{formatDecimal(sug.combinedDecimal)}</span>
                    <span className="nums text-mist-500"> · {formatPercent(sug.modelledProbability, 0)}</span>
                    <p className="text-[11.5px] text-mist-400">{sug.legs.map((l) => l.selection).join(" · ")}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {s.state === "in" && (data.canRead ? (
            cooling ? <p className="mt-1.5 text-[11.5px] text-mist-500">{c.readNext.replace("{t}", formatTime(data.nextReadAt!, lang))}</p> : (
              <button type="button" onClick={askRead} disabled={busy} data-testid="live-read-btn" className="mt-2 rounded-lg border border-signal-500/50 px-3 py-1.5 text-[12px] text-signal-400 hover:bg-signal-500/10 disabled:opacity-50">{busy ? c.readBusy : c.readBtn}</button>
            )
          ) : <p className="mt-1.5 text-[11.5px] text-mist-500" data-testid="live-read-plan">{c.readPlan}</p>)}
          {note && <p className="mt-1.5 text-[12px] text-warn-400">{note}</p>}
        </div>
      </div>
    </section>
  );
}
