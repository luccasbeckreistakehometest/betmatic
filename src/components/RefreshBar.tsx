"use client";

import { useEffect, useState } from "react";
import type { Lang } from "@/lib/i18n";

interface State { verdict: string; reason: "lineup" | "lines" | null; used?: number; perUser?: number }

const C = {
  pt: {
    lineup: "A escalação mexeu em pernas destes bilhetes depois que eles foram montados.",
    lines: "As linhas mudaram desde que estes bilhetes foram montados, há mais de 6 horas.",
    button: "Atualizar os bilhetes deste jogo", busy: "Remontando com os dados de agora…", used: "{used} de {cap} atualizações hoje",
    done: "Bilhetes atualizados. Os antigos continuam no histórico público.", capUser: "Você já usou as {cap} atualizações de hoje.", capGlobal: "As atualizações de hoje se esgotaram. Amanhã volta.",
    failed: "Não deu para atualizar agora. Nada foi descontado.",
  },
  en: {
    lineup: "The lineup changed legs on these tickets after they were built.",
    lines: "The lines moved since these tickets were built, more than 6 hours ago.",
    button: "Refresh this game's tickets", busy: "Rebuilding with today's data…", used: "{used} of {cap} refreshes today",
    done: "Tickets refreshed. The old ones stay in the public record.", capUser: "You've used today's {cap} refreshes.", capGlobal: "Today's refreshes have run out. Back tomorrow.",
    failed: "Couldn't refresh right now. Nothing was used up.",
  },
};

/** Max only: "atualizar os bilhetes" appears when an input changed since the tickets were built. */
export function RefreshBar({ gameId, sportKey, lang, onRefreshed }: { gameId: string; sportKey: string; lang: Lang; onRefreshed: () => void }) {
  const c = C[lang];
  const [state, setState] = useState<State | null>(null);
  const [phase, setPhase] = useState<"idle" | "busy" | "done" | "failed">("idle");

  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      fetch(`/api/game/${gameId}/refresh?sport=${sportKey}&lang=${lang}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (alive) setState(j); })
        .catch(() => {});
    }, 0);
    return () => { alive = false; clearTimeout(id); };
  }, [gameId, sportKey, lang]);

  async function refresh() {
    setPhase("busy");
    const r = await fetch(`/api/game/${gameId}/refresh?sport=${sportKey}&lang=${lang}`, { method: "POST" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok) {
      setPhase("done");
      setState((s) => (s ? { ...s, verdict: "unchanged", used: (s.used ?? 0) + 1 } : s));
      onRefreshed();
      return;
    }
    setPhase("failed");
    if (j.status) setState((s) => (s ? { ...s, verdict: j.status } : s));
  }

  if (phase === "done") return <p className="mb-3 rounded-lg border border-edge-400/30 bg-edge-400/5 px-3 py-2 text-[12px] text-edge-400" data-testid="refresh-done">{c.done}</p>;
  if (!state || !["available", "cap_user", "cap_global"].includes(state.verdict)) return phase === "failed" ? <p className="mb-3 text-[12px] text-warn-400">{c.failed}</p> : null;
  const cap = String(state.perUser ?? 3);
  return (
    <div className="mb-3 rounded-lg border border-signal-500/30 bg-signal-500/[0.06] px-3 py-2.5" data-testid="refresh-bar">
      <p className="text-[12.5px] text-mist-200">{state.reason === "lineup" ? c.lineup : c.lines}</p>
      {state.verdict === "available" ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" onClick={refresh} disabled={phase === "busy"} data-testid="refresh-tickets" className="rounded-lg bg-signal-500 px-3 py-1.5 text-[12px] font-semibold text-ink-950 hover:bg-signal-400 disabled:opacity-50">
            {phase === "busy" ? c.busy : c.button}
          </button>
          <span className="nums text-[11px] text-mist-500">{c.used.replace("{used}", String(state.used ?? 0)).replace("{cap}", cap)}</span>
          {phase === "failed" && <span className="text-[12px] text-warn-400">{c.failed}</span>}
        </div>
      ) : (
        <p className="mt-1 text-[12px] text-mist-500">{(state.verdict === "cap_user" ? c.capUser : c.capGlobal).replace("{cap}", cap)}</p>
      )}
    </div>
  );
}
