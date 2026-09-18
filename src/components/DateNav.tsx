"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Icon } from "@/components/Icon";
import { cx } from "@/components/ui";
import { normaliseLang } from "@/lib/i18n";

function shift(dateKey: string, days: number): string {
  const dt = new Date(Date.UTC(+dateKey.slice(0, 4), +dateKey.slice(4, 6) - 1, +dateKey.slice(6, 8)));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, "0")}${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function toInputValue(dateKey: string): string {
  return `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
}

/**
 * The date control is one segmented group, not three floating buttons: a day back, the day itself,
 * a day forward, joined by single hairlines so the whole thing reads as one instrument. The label
 * sits inside the group and carries the pending state as a word, never as a colour alone.
 */
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

  const step = "grid h-(--row-h) w-8 shrink-0 place-items-center text-fg-muted transition-colors duration-(--dur-1) hover:bg-surface-2 hover:text-fg";

  return (
    <div className="flex items-stretch divide-x divide-line rounded-control border border-line-control bg-surface-1">
      <button type="button" onClick={() => go(shift(dateKey, -1))} className={step} aria-label={L.prev}>
        <Icon name="chevron-left" size={16} />
      </button>

      <label className="relative flex items-center gap-2 px-2.5">
        <span className="sr-only">{L.date}</span>
        <Icon name="calendar" size={16} className="shrink-0 text-fg-dim" />
        <span className={cx("hidden text-sm whitespace-nowrap sm:inline", pending ? "text-fg-dim" : "text-fg")}>
          {pending ? L.loading : label}
        </span>
        {/* The native picker stays the input, but it is transparent and sits over the label we
            drew, so every browser paints the same control and the reader sees ours. */}
        <input
          type="date"
          aria-label={L.date}
          value={toInputValue(dateKey)}
          onChange={(e) => {
            const v = e.target.value.replaceAll("-", "");
            if (v.length === 8) go(v);
          }}
          className="nums h-(--row-h) w-[7.5rem] bg-transparent text-sm text-fg sm:absolute sm:inset-0 sm:w-full sm:opacity-0"
        />
      </label>

      <button type="button" onClick={() => go(shift(dateKey, 1))} className={step} aria-label={L.next}>
        <Icon name="chevron-right" size={16} />
      </button>
    </div>
  );
}
