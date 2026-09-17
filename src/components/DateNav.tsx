"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { normaliseLang } from "@/lib/i18n";

function shift(dateKey: string, days: number): string {
  const dt = new Date(Date.UTC(+dateKey.slice(0, 4), +dateKey.slice(4, 6) - 1, +dateKey.slice(6, 8)));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, "0")}${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function toInputValue(dateKey: string): string {
  return `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
}

export function DateNav({ dateKey, label }: { dateKey: string; label: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const lang = normaliseLang(search.get("lang"));
  const L = lang === "pt"
    ? { prev: "Dia anterior", next: "Próximo dia", date: "Data dos jogos", loading: "carregando…" }
    : { prev: "Previous day", next: "Next day", date: "Game date", loading: "loading…" };

  const go = (next: string) => {
    const params = new URLSearchParams(search.toString());
    params.set("date", next);
    startTransition(() => router.push(`/app?${params.toString()}`));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => go(shift(dateKey, -1))}
        className="rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-sm text-mist-300 transition hover:border-ink-600 hover:text-white"
        aria-label={L.prev}
      >
        ←
      </button>

      <div className="relative">
        <input
          type="date"
          aria-label={L.date}
          value={toInputValue(dateKey)}
          onChange={(e) => {
            const v = e.target.value.replaceAll("-", "");
            if (v.length === 8) go(v);
          }}
          className="nums rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm text-mist-100 outline-none transition focus:border-signal-500"
        />
      </div>

      <button
        onClick={() => go(shift(dateKey, 1))}
        className="rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-sm text-mist-300 transition hover:border-ink-600 hover:text-white"
        aria-label={L.next}
      >
        →
      </button>

      <span className={`text-sm ${pending ? "text-signal-400" : "text-mist-400"}`}>
        {pending ? L.loading : label}
      </span>
    </div>
  );
}
