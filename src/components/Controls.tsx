"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { LANGS, makeT, normaliseLang } from "@/lib/i18n";
import { SPORTS, getSport } from "@/lib/sports";

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

export function SportPicker() {
  const { sport, setParam, lang } = useNavState();
  const groups = [
    { key: "basketball", label: { pt: "Basquete", en: "Basketball" } },
    { key: "soccer", label: { pt: "Futebol", en: "Soccer" } },
    { key: "tennis", label: { pt: "Tênis", en: "Tennis" } },
  ] as const;

  return (
    <select
      data-tour="sport"
      value={sport.key}
      onChange={(e) => setParam("sport", e.target.value)}
      className="rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-[13px] text-mist-100 outline-none transition focus:border-signal-500"
    >
      {groups.map((group) => (
        <optgroup key={group.key} label={group.label[lang]}>
          {SPORTS.filter((s) => s.group === group.key).map((s) => (
            <option key={s.key} value={s.key}>
              {s.label[lang]}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function LangPicker() {
  const { lang, setParam } = useNavState();
  return (
    <div className="flex overflow-hidden rounded-lg border border-ink-700">
      {LANGS.map((l) => (
        <button
          key={l.key}
          onClick={() => setParam("lang", l.key)}
          className={`px-2 py-1 text-[11px] font-medium transition ${
            lang === l.key ? "bg-signal-500 text-ink-950" : "bg-ink-850 text-mist-400 hover:text-mist-100"
          }`}
          title={l.label}
        >
          {l.flag}
        </button>
      ))}
    </div>
  );
}

export function T({ k }: { k: Parameters<ReturnType<typeof makeT>>[0] }) {
  const { lang } = useNavState();
  return <>{makeT(lang)(k)}</>;
}

const NAV = [
  { href: "/app", key: "navSlate" },
  { href: "/app/parlays", key: "navParlays" },
  { href: "/app/slip", key: "mySlip" },
  { href: "/app/track", key: "navTrack" },
] as const;

export function NavLinks() {
  const { lang, sport } = useNavState();
  const pathname = usePathname();
  const t = makeT(lang);
  return (
    <nav className="flex items-center gap-1" data-tour="nav">
      {NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={{ pathname: item.href, query: { sport: sport.key, lang } }}
            className={`rounded-lg px-2.5 py-1 text-[12px] transition ${
              active ? "bg-ink-800 text-mist-100" : "text-mist-500 hover:text-mist-300"
            }`}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
