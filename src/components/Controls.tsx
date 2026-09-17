"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { LANGS, makeT, normaliseLang, type DictKey } from "@/lib/i18n";
import { SOLD_SPORTS, getSport } from "@/lib/sports";

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
      <select
        data-tour="sport"
        value={sport.key}
        onChange={(e) => setParam("sport", e.target.value)}
        className="max-w-[9.5rem] rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-[13px] text-mist-100 outline-none transition focus:border-signal-500 sm:max-w-none"
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
      </select>
    </label>
  );
}

export function LangPicker({ className = "" }: { className?: string }) {
  const { lang, setParam } = useNavState();
  return (
    <div className={`flex overflow-hidden rounded-lg border border-ink-700 ${className}`} role="group" aria-label={lang === "pt" ? "Idioma" : "Language"}>
      {LANGS.map((l) => (
        <button
          key={l.key}
          type="button"
          onClick={() => setParam("lang", l.key)}
          aria-pressed={lang === l.key}
          aria-label={l.label}
          lang={l.key === "pt" ? "pt-BR" : "en"}
          className={`px-2 py-1 text-[11px] font-medium transition ${
            lang === l.key ? "bg-signal-500 text-ink-950" : "bg-ink-850 text-mist-400 hover:text-mist-100"
          }`}
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

/** `tour` names the anchor the first-visit tour points at for that link. */
export const PRIMARY_NAV: { href: string; key: DictKey; tour?: string }[] = [
  { href: "/app", key: "navSlate" },
  { href: "/app/parlays", key: "navParlays" },
  { href: "/app/slip", key: "mySlip" },
  { href: "/app/bankroll", key: "bankroll", tour: "bankroll" },
  { href: "/app/track", key: "navTrack" },
];

export const SECONDARY_NAV: { href: string; key: DictKey; tour?: string }[] = [
  { href: "/app/alerts", key: "navAlerts", tour: "alerts" },
  { href: "/app/tipster", key: "navTipster" },
  { href: "/app/report", key: "navReport" },
  { href: "/app/ranking", key: "navRanking" },
  { href: "/app/referral", key: "referral" },
  { href: "/app/settings", key: "navSettings", tour: "settings" },
  { href: "/app/conta", key: "navAccount" },
  { href: "/planos", key: "navPlans" },
];

/** Desktop only; phones get the menu (MobileMenu). */
export function NavLinks() {
  const { lang, sport } = useNavState();
  const pathname = usePathname();
  const t = makeT(lang);
  return (
    <nav className="hidden items-center gap-1 lg:flex" data-tour="nav" aria-label={lang === "pt" ? "Navegação principal" : "Main navigation"}>
      {PRIMARY_NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={{ pathname: item.href, query: { sport: sport.key, lang } }}
            data-tour={item.tour}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-[12px] transition ${
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
