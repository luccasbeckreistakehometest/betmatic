"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

/** The five a phone gets. Everything else is one tap away in the header menu. */
const BOTTOM: Item[] = [
  { href: "/app", key: "navSlate", icon: "grid" },
  { href: "/app/parlays", key: "navParlays", icon: "layers" },
  { href: "/app/slip", key: "mySlip", icon: "receipt" },
  { href: "/app/bankroll", key: "bankroll", icon: "wallet" },
  { href: "/app/track", key: "navTrack", icon: "list-check" },
];

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

/** Phone navigation. Safe-area padding, 44px targets, the same current-item rule as the rail. */
export function AppBottomBar() {
  const { lang, sport } = useNavState();
  const pathname = usePathname();
  const t = makeT(lang);
  return (
    <nav
      aria-label={lang === "pt" ? "Navegação" : "Navigation"}
      className="sticky bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface-1 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {BOTTOM.map((item) => {
        const current = isCurrent(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={{ pathname: item.href, query: { sport: sport.key, lang } }}
            aria-current={current ? "page" : undefined}
            className={cx(
              "u-ring-inset flex h-12 flex-col items-center justify-center gap-0.5 text-micro",
              current ? "text-fg shadow-[inset_0_2px_0_var(--fg)]" : "text-fg-dim",
            )}
          >
            <Icon name={item.icon} size={16} />
            <span className="max-w-full truncate px-1">{t(item.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
