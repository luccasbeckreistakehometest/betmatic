"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { useNavState } from "@/components/Controls";
import { cx } from "@/components/ui";
import { makeT, type DictKey } from "@/lib/i18n";

/**
 * The rail. Thirteen destinations, all of them visible at ≥1024px, because a desk tool that hides
 * two thirds of itself behind a hamburger is a website. Between 768 and 1023 it keeps the same
 * order as a 56px column of glyphs; below 768 it leaves and the five most-used destinations become
 * a bottom bar (§14 of docs/DESIGN.md).
 *
 * Grouping is the hierarchy: what you are looking at, what you staked, what the market is doing,
 * and who you are. The current item is marked by a 2px ink bar and a surface step, never by a hue
 * alone — the blue is the keyboard's position and nothing else.
 */

type Item = { href: string; key: DictKey; icon: IconName; tour?: string };

export const NAV_GROUPS: { label: { pt: string; en: string }; items: Item[] }[] = [
  {
    label: { pt: "Mesa", en: "Desk" },
    items: [
      // The short list first: what to bet tonight, and how much. Everything else is still here.
      { href: "/app/hoje", key: "navToday", icon: "calendar", tour: "today" },
      { href: "/app", key: "navSlate", icon: "grid" },
      { href: "/app/parlays", key: "navParlays", icon: "layers" },
      { href: "/app/slip", key: "mySlip", icon: "receipt" },
    ],
  },
  {
    label: { pt: "Banca", en: "Bankroll" },
    items: [
      { href: "/app/bankroll", key: "bankroll", icon: "wallet", tour: "bankroll" },
      { href: "/app/track", key: "navTrack", icon: "list-check" },
      { href: "/app/report", key: "navReport", icon: "bars" },
    ],
  },
  {
    label: { pt: "Mercado", en: "Market" },
    items: [
      { href: "/app/alerts", key: "navAlerts", icon: "bell", tour: "alerts" },
      { href: "/app/tipster", key: "navTipster", icon: "target" },
      { href: "/app/ranking", key: "navRanking", icon: "trophy" },
    ],
  },
  {
    label: { pt: "Conta", en: "Account" },
    items: [
      { href: "/app/settings", key: "navSettings", icon: "sliders", tour: "settings" },
      { href: "/app/conta", key: "navAccount", icon: "user" },
      { href: "/app/referral", key: "referral", icon: "gift" },
      { href: "/planos", key: "navPlans", icon: "tag" },
    ],
  },
];

/**
 * The phone's tabs: the day's short list, the slate, the parlays, the bankroll and the account —
 * and, while a game of the current sport is being played, that game, so the live panel is one tap
 * away from anywhere. Everything else is in the header menu, in the rail's own order. Nothing was
 * dropped to make room for "Hoje": the bar grows to six columns while a game is under way.
 */
const TABS: { href: string; key: DictKey; icon: IconName }[] = [
  { href: "/app/hoje", key: "navToday", icon: "calendar" },
  { href: "/app", key: "navSlate", icon: "grid" },
  { href: "/app/parlays", key: "navParlays", icon: "layers" },
  { href: "/app/bankroll", key: "tabBankroll", icon: "wallet" },
  { href: "/app/conta", key: "tabAccount", icon: "user" },
];

export interface LiveTabGame { id: string; label: string; name: string }
/** What the server knew when it rendered the shell: the sport it looked at and its games in play. */
export interface LiveTabInitial { sportKey: string; games: LiveTabGame[] }

const sameGames = (a: LiveTabGame[], b: LiveTabGame[]) => a.length === b.length && a.every((g, i) => g.id === b[i].id);

/**
 * The games of the current sport under way right now. The shell answers first, on the server, so
 * the bar is right on first paint and nothing moves under the thumb; the phone then re-reads the
 * slate every 90 s while the tab is visible, because a game can start while the app is open. Only
 * a phone asks (a desk never draws the bar), and it asks at once only when the server looked at
 * another sport than the one in the URL.
 */
function useLiveGames(sportKey: string, lang: string, initial: LiveTabInitial | null): LiveTabGame[] {
  const seeded = initial?.sportKey === sportKey;
  const [read, setRead] = useState<{ sportKey: string; games: LiveTabGame[] } | null>(null);
  useEffect(() => {
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    let alive = true;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await fetch(`/api/slate?sport=${encodeURIComponent(sportKey)}&lang=${lang}`, { cache: "no-store" }).catch(() => null);
      if (!alive || !r?.ok) return;
      const j = (await r.json().catch(() => null)) as { games?: { id: string; status: string; home: { abbreviation: string; displayName: string }; away: { abbreviation: string; displayName: string } }[] } | null;
      const games = (j?.games ?? []).filter((g) => g.status === "live").map((g) => ({ id: g.id, label: `${g.away.abbreviation} × ${g.home.abbreviation}`, name: `${g.away.displayName} × ${g.home.displayName}` }));
      setRead((prev) => (prev && prev.sportKey === sportKey && sameGames(prev.games, games) ? prev : { sportKey, games }));
    };
    const first = seeded ? null : setTimeout(() => void tick(), 0);
    const timer = setInterval(() => void tick(), 90_000);
    const onVisible = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; if (first) clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [sportKey, lang, seeded]);
  if (read && read.sportKey === sportKey) return read.games;
  return seeded && initial ? initial.games : [];
}

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}
export function AppRail() {
  const { lang, sport } = useNavState();
  const pathname = usePathname();
  const t = makeT(lang);
  const query = (href: string) => (href.startsWith("/app") ? { sport: sport.key, lang } : { lang });

  return (
    <nav
      data-tour="nav"
      aria-label={lang === "pt" ? "Navegação principal" : "Main navigation"}
      className="sticky top-(--topbar-h) hidden h-[calc(100dvh-var(--topbar-h))] w-14 shrink-0 self-start overflow-y-auto border-r border-line bg-surface-1 md:block lg:w-56"
    >
      <div className="flex flex-col py-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label.en} className="mb-1 pb-1 not-last:border-b not-last:border-line">
            <p className="hidden px-3 pt-2 pb-1 text-label u-label text-fg-dim lg:block">{group.label[lang]}</p>
            <span className="sr-only lg:hidden">{group.label[lang]}</span>
            {group.items.map((item) => {
              const current = isCurrent(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={{ pathname: item.href, query: query(item.href) }}
                  data-tour={item.tour}
                  aria-current={current ? "page" : undefined}
                  title={t(item.key)}
                  className={cx(
                    "u-ring-inset relative flex h-9 items-center gap-2.5 px-3 text-sm transition-colors duration-(--dur-1) ease-(--ease-out)",
                    "max-lg:justify-center max-lg:px-0",
                    current
                      ? "bg-surface-2 font-medium text-fg before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-fg"
                      : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <Icon name={item.icon} size={16} className={current ? "text-fg" : "text-fg-dim"} />
                  <span className="truncate max-lg:sr-only">{t(item.key)}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}

/**
 * Phone navigation: a fixed bar under everything, 56px plus the device's own inset, every tab the
 * full height (a fingertip never misses). The current tab carries the rail's cue — a 2px rule in
 * ink on its top edge and full-contrast text (§12.7) — so a glance tells where you are without
 * reading, and the product keeps one current-item colour. The live tab names the game.
 */
export function AppBottomBar({ initialLive = null }: { initialLive?: LiveTabInitial | null }) {
  const { lang, sport } = useNavState();
  const pathname = usePathname();
  const t = makeT(lang);
  const live = useLiveGames(sport.key, lang, initialLive);
  const one = live.length === 1 ? live[0] : null;
  const liveHref = one ? `/app/game/${one.id}` : live.length > 1 ? "/app" : null;
  const onLiveGame = one !== null && pathname === `/app/game/${one.id}`;

  const tabs = TABS.flatMap((item) => {
    const current = item.href === "/app"
      ? (pathname === "/app" || pathname.startsWith("/app/game/")) && !onLiveGame
      : isCurrent(pathname, item.href);
    const tab = { href: item.href, label: t(item.key), icon: item.icon, current, live: false, mono: false, aria: undefined as string | undefined, title: undefined as string | undefined };
    // The live game sits between the desk and the bankroll: where you are, then what it costs you.
    if (item.href !== "/app/parlays" || !liveHref) return [tab];
    const liveTab = one
      ? { href: liveHref, label: one.label, icon: "pulse" as IconName, current: onLiveGame, live: true, mono: true, aria: `${t("tabLive")}: ${one.name}`, title: one.name }
      : { href: liveHref, label: t("tabLiveMany").replace("{n}", String(live.length)), icon: "pulse" as IconName, current: false, live: true, mono: false, aria: undefined, title: undefined };
    return [tab, liveTab];
  });

  return (
    <nav
      data-tabbar
      data-testid="tab-bar"
      aria-label={lang === "pt" ? "Navegação" : "Navigation"}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface-1 pb-(--safe-b) md:hidden"
    >
      <ul className={cx("grid h-14", tabs.length >= 6 ? "grid-cols-6" : tabs.length === 5 ? "grid-cols-5" : "grid-cols-4")}>
        {tabs.map((tab) => (
          <li key={tab.href} className="min-w-0">
            <Link
              href={{ pathname: tab.href, query: { sport: sport.key, lang } }}
              aria-current={tab.current ? "page" : undefined}
              aria-label={tab.aria}
              title={tab.title}
              data-testid={tab.live ? "tab-live" : undefined}
              className={cx(
                "u-ring-inset flex h-14 flex-col items-center justify-center gap-1 text-label transition-colors duration-(--dur-1) ease-(--ease-out)",
                tab.current ? "u-tab-current text-fg" : "text-fg-dim active:bg-surface-2",
              )}
            >
              <span className="relative">
                <Icon name={tab.icon} size={20} />
                {tab.live && <span aria-hidden="true" className="live-dot absolute -top-0.5 -right-1 size-1.5 rounded-full bg-neg" />}
              </span>
              <span className={cx("max-w-full truncate px-1", tab.mono && "nums")}>{tab.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
