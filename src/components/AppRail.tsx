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
 * The phone's tabs: the slate, the parlays, the bankroll and the account — and, while a game of
 * the current sport is being played, that game, so the live panel is one tap away from anywhere.
 * Everything else is in the header menu, in the rail's own order.
 */
const TABS: { href: string; key: DictKey; icon: IconName }[] = [
  { href: "/app", key: "navSlate", icon: "grid" },
  { href: "/app/parlays", key: "navParlays", icon: "layers" },
  { href: "/app/bankroll", key: "tabBankroll", icon: "wallet" },
  { href: "/app/conta", key: "tabAccount", icon: "user" },
];

interface LiveGame { id: string; label: string }

/**
 * The game of the current sport that is under way right now, if there is one. Read from the slate
 * the phone is already looking at, only on a phone (a desk never draws the bar), only while the tab
 * is visible, and refreshed every 90 s — a game rarely changes state faster than that.
 */
function useLiveGame(sportKey: string, lang: string): LiveGame | null {
  const [live, setLive] = useState<LiveGame | null>(null);
  useEffect(() => {
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    let alive = true;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await fetch(`/api/slate?sport=${encodeURIComponent(sportKey)}&lang=${lang}`, { cache: "no-store" }).catch(() => null);
      if (!alive || !r?.ok) return;
      const j = (await r.json().catch(() => null)) as { games?: { id: string; status: string; home: { abbreviation: string }; away: { abbreviation: string } }[] } | null;
      const game = (j?.games ?? []).find((g) => g.status === "live");
      setLive((prev) => (game ? (prev?.id === game.id ? prev : { id: game.id, label: `${game.away.abbreviation} × ${game.home.abbreviation}` }) : null));
    };
    const first = setTimeout(() => void tick(), 0);
    const timer = setInterval(() => void tick(), 90_000);
    const onVisible = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [sportKey, lang]);
  return live;
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
      className="sticky top-12 hidden h-[calc(100dvh-3rem)] w-14 shrink-0 self-start overflow-y-auto border-r border-line bg-surface-1 md:block lg:w-56"
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
 * Phone navigation: a fixed bar under everything, 56px tall plus the device's own inset, every tab
 * the full height (a fingertip never misses). The current tab carries the keyboard's blue as a 2px
 * rule on top and full-contrast ink — the one place besides focus where the hue appears (§6.1) —
 * so a glance tells where you are without reading. The live tab carries the live dot.
 */
export function AppBottomBar() {
  const { lang, sport } = useNavState();
  const pathname = usePathname();
  const t = makeT(lang);
  const live = useLiveGame(sport.key, lang);
  const liveHref = live ? `/app/game/${live.id}` : null;
  const onLiveGame = liveHref !== null && pathname === liveHref;

  const tabs = TABS.flatMap((item) => {
    const current = item.href === "/app"
      ? (pathname === "/app" || pathname.startsWith("/app/game/")) && !onLiveGame
      : isCurrent(pathname, item.href);
    const tab = { href: item.href, label: t(item.key), icon: item.icon, current, live: false, title: undefined as string | undefined };
    // The live game sits between the desk and the bankroll: where you are, then what it costs you.
    return item.href === "/app/parlays" && liveHref
      ? [tab, { href: liveHref, label: t("tabLive"), icon: "pulse" as IconName, current: onLiveGame, live: true, title: live?.label }]
      : [tab];
  });

  return (
    <nav
      data-tabbar
      data-testid="tab-bar"
      aria-label={lang === "pt" ? "Navegação" : "Navigation"}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface-1 pb-(--safe-b) md:hidden"
    >
      <ul className={cx("grid h-14", tabs.length === 5 ? "grid-cols-5" : "grid-cols-4")}>
        {tabs.map((tab) => (
          <li key={tab.href} className="min-w-0">
            <Link
              href={{ pathname: tab.href, query: { sport: sport.key, lang } }}
              aria-current={tab.current ? "page" : undefined}
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
              <span className="max-w-full truncate px-1">{tab.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
