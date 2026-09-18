"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { LANGS, makeT, normaliseLang } from "@/lib/i18n";
import { SOLD_SPORTS, getSport } from "@/lib/sports";
import { Select } from "@/components/ui";

/** Sport, language and date all live in the URL so any view can be linked and shared. */
export function useNavState() {
  const params = useSearchParams();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const lang = normaliseLang(params.get("lang"));
  const sport = getSport(params.get("sport") ?? undefined);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      next.set(key, value);
      // Changing sport invalidates the selected game's date context.
      if (key === "sport") next.delete("date");
      startTransition(() => router.push(`?${next.toString()}`));
    },
    [params, router],
  );

  return { lang, sport, params, setParam, pending };
}

export function SportPicker({ className = "" }: { className?: string }) {
  const { sport, setParam, lang } = useNavState();
  const groups = [
    { key: "basketball", label: { pt: "Basquete", en: "Basketball" } },
    { key: "soccer", label: { pt: "Futebol", en: "Soccer" } },
  ] as const;
  // A sport that is not sold (tennis) can still arrive by link; it stays selectable for that page.
  const options = SOLD_SPORTS.some((s) => s.key === sport.key) ? SOLD_SPORTS : [...SOLD_SPORTS, sport];

  return (
    <label className={`flex min-w-0 items-center ${className}`}>
      <span className="sr-only">{lang === "pt" ? "Esporte e liga" : "Sport and league"}</span>
      <Select
        data-tour="sport"
        value={sport.key}
        onChange={(e) => setParam("sport", e.target.value)}
        className="max-w-[9.5rem] sm:max-w-none"
      >
        {groups.map((group) => (
          <optgroup key={group.key} label={group.label[lang]}>
            {options.filter((s) => s.group === group.key).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label[lang]}
              </option>
            ))}
          </optgroup>
        ))}
        {options.filter((s) => s.group === "tennis").map((s) => (
          <option key={s.key} value={s.key}>{s.label[lang]}</option>
        ))}
      </Select>
    </label>
  );
}

export function LangPicker({ className = "" }: { className?: string }) {
  const { lang, setParam } = useNavState();
  return (
    <div className={`flex overflow-hidden rounded-control border border-line-control ${className}`} role="group" aria-label={lang === "pt" ? "Idioma" : "Language"}>
      {LANGS.map((l) => (
        <button
          key={l.key}
          type="button"
          onClick={() => setParam("lang", l.key)}
          aria-pressed={lang === l.key}
          aria-label={l.label}
          lang={l.key === "pt" ? "pt-BR" : "en"}
          // A flag is not a language. Two letters are, and they survive a monochrome palette.
          className={`px-1.5 py-1 text-micro u-label transition-colors duration-(--dur-1) ${
            lang === l.key ? "bg-action text-action-fg" : "bg-surface-1 text-fg-dim hover:text-fg"
          }`}
        >
          {l.key.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function T({ k }: { k: Parameters<ReturnType<typeof makeT>>[0] }) {
  const { lang } = useNavState();
  return <>{makeT(lang)(k)}</>;
}
