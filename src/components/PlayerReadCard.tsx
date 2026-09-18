"use client";

import { useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui";
import type { PlayerCopy } from "@/components/player-copy";
import type { PlayerProfileView } from "@/lib/props/player-view";
import type { Lang } from "@/lib/i18n";

export interface ReadState {
  read: { text: string; watch: string; generatedAt: string } | null;
  price: number;
  coins: number;
  aiReady: boolean;
}

/** The optional analyst paragraph: paid once per player per day, then free for everyone. */
export function PlayerReadCard({ profile, gameId, lang, c, initial }: { profile: PlayerProfileView; gameId: string | null; lang: Lang; c: PlayerCopy; initial: ReadState }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "warn"; text: string; buy?: boolean } | null>(null);

  async function request() {
    setBusy(true);
    setNote(null);
    const r = await fetch(`/api/player/${profile.athleteId}/read`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sport: profile.sportKey, lang, game: gameId }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (r?.ok) {
      setState((s) => ({ ...s, read: j.read, coins: j.balance ?? s.coins }));
      setNote({ tone: "ok", text: j.coinsSpent ? c.readSpent.replace("{n}", String(j.coinsSpent)) : c.readCached });
      return;
    }
    if (r?.status === 402) return setNote({ tone: "warn", text: c.noCoins, buy: true });
    if (r?.status === 423) return setNote({ tone: "warn", text: c.paused });
    setNote({ tone: "warn", text: j.message ?? c.aiOff });
  }

  return (
    <Panel title={c.read} lang={lang}>
      {state.read ? (
        <div data-testid="player-read">
          <p className="text-sm leading-relaxed text-fg">{state.read.text}</p>
          {state.read.watch && <p className="mt-2 border-l-2 border-focus pl-2 text-tiny text-fg-muted"><span className="font-medium text-fg-muted">{c.watch}: </span>{state.read.watch}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-tiny text-fg-muted">{c.readBody}</p>
          {state.aiReady ? (
            <button type="button" onClick={request} disabled={busy} data-testid="player-read-btn"
              className="w-fit rounded-control border border-pos px-3 py-1.5 text-tiny font-semibold text-pos hover:bg-action-hover disabled:bg-surface-3 disabled:text-fg-faint disabled:cursor-not-allowed">
              {busy ? c.readBusy : state.price ? c.readBtn.replace("{n}", String(state.price)) : c.readFree}
            </button>
          ) : (
            <p className="text-tiny text-fg-dim" data-testid="player-read-off">{c.aiOff}</p>
          )}
        </div>
      )}
      {note && (
        <p className={`mt-2 text-tiny ${note.tone === "ok" ? "text-fg-muted" : "text-warn"}`} data-testid="player-read-note">
          {note.text}
          {note.buy && <> · <Link href={{ pathname: "/planos", query: { lang } }} className="underline">{c.buy}</Link></>}
        </p>
      )}
    </Panel>
  );
}
