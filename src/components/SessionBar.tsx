"use client";

import { useEffect, useState } from "react";

interface SessionInfo {
  sessions: Record<string, { present: boolean; ageMs: number | null; requiresLogin: boolean; label: string }>;
  ai: { configured: boolean; model: string };
}

function ageLabel(ms: number | null): string {
  if (ms === null) return "";
  const days = ms / 86_400_000;
  return days < 1 ? `${Math.max(1, Math.round(ms / 3_600_000))}h` : `${Math.round(days)}d`;
}

export function SessionBar() {
  const [info, setInfo] = useState<SessionInfo | null>(null);

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  if (!info) return <div className="h-6 w-40 animate-pulse rounded bg-ink-800" />;

  return (
    <div className="flex items-center gap-3 text-[11px]">
      {Object.entries(info.sessions).map(([key, value]) => {
        const stale = value.present && value.ageMs !== null && value.ageMs > 14 * 86_400_000;
        const missing = value.requiresLogin && !value.present;
        const tone = missing ? "bg-alert-400" : stale ? "bg-warn-400" : "bg-edge-400";
        const title = !value.requiresLogin
          ? "Open source — no login needed"
          : missing
            ? `No saved session — run: pnpm login ${key}`
            : `Session saved ${ageLabel(value.ageMs)} ago${stale ? " (probably stale)" : ""}`;
        return (
          <span key={key} className="flex items-center gap-1.5 text-mist-400" title={title}>
            <span className={`size-1.5 rounded-full ${tone}`} />
            {value.label}
          </span>
        );
      })}
      <span
        className="flex items-center gap-1.5 border-l border-ink-700 pl-3 text-mist-400"
        title={info.ai.configured ? `AI extraction on (${info.ai.model})` : "ANTHROPIC_API_KEY not set"}
      >
        <span className={`size-1.5 rounded-full ${info.ai.configured ? "bg-edge-400" : "bg-alert-400"}`} />
        AI
      </span>
    </div>
  );
}
