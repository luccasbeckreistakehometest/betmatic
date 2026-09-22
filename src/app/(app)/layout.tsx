import Link from "next/link";
import { cookies, headers } from "next/headers";
import { Suspense } from "react";
import type { Metadata } from "next";
import { SportPicker } from "@/components/Controls";
import { AppBottomBar, AppRail, type LiveTabInitial } from "@/components/AppRail";
import { SPORT_COOKIE, soldSportKey } from "@/lib/server/default-sport";
import { getSlate, todayKey } from "@/lib/sources/espn";
import { Disclaimer } from "@/components/Disclaimer";
import { Logo } from "@/components/Logo";
import { AccountBar } from "@/components/AccountBar";
import { Tour } from "@/components/Tour";
import { ResponsibleGuard } from "@/components/ResponsibleGuard";
import { telegramConfigured } from "@/lib/server/telegram";
import { aiConfigured } from "@/lib/ai/client";

// The logged-in app is private: nothing under /app belongs in a search index.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The desk: a 48px topbar of context (who, which sport), a rail of destinations, and the work
 * column, which has no max-width — data fills the monitor it was opened on. The chrome is ruled,
 * not floated: one hairline under the bar and one down the rail, no shadow, no blur.
 */
/**
 * The phone's live tab, decided here so the bar is right on first paint and never reflows: the
 * games under way now in the sport the URL names (forwarded by the proxy), else the remembered
 * one. Read from the cached scoreboard; a feed error answers null and the bar reads the slate.
 */
async function liveTabInitial(): Promise<LiveTabInitial | null> {
  const [head, jar] = await Promise.all([headers(), cookies()]);
  const sportKey = soldSportKey(head.get("x-bm-sport")) ?? soldSportKey(jar.get(SPORT_COOKIE)?.value) ?? null;
  if (!sportKey) return null;
  try {
    const games = await getSlate(todayKey(), false, sportKey);
    return {
      sportKey,
      games: games.filter((g) => g.status === "live").map((g) => ({ id: g.id, label: `${g.away.abbreviation} × ${g.home.abbreviation}`, name: `${g.away.displayName} × ${g.home.displayName}` })),
    };
  } catch {
    return null;
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const live = await liveTabInitial();
  return (
    <div className="flex min-h-dvh flex-col pb-(--tabbar-h)" data-density="default">
      {/* 48px of bar under the status bar an installed app keeps: the inset is padding, so the bar
          is drawn below it and everything that sticks under the bar (--topbar-h) follows. */}
      <header className="sticky top-0 z-40 flex h-[calc(3rem+var(--safe-t))] shrink-0 items-center gap-3 border-b border-line bg-surface-1 px-3 pt-(--safe-t) md:px-4">
        <Link href="/app" className="flex h-11 min-w-11 shrink-0 items-center" aria-label="Betmatic">
          <span className="lg:hidden"><Logo size={22} showWord={false} /></span>
          <span className="hidden lg:inline"><Logo size={22} /></span>
        </Link>
        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-line" />
        {/* useSearchParams needs a Suspense boundary when rendered from a server layout. */}
        <Suspense fallback={<div className="h-7 w-32 rounded-control bg-surface-2" />}>
          <SportPicker className="min-w-0" />
        </Suspense>
        <div className="ml-auto flex shrink-0 items-center">
          <Suspense fallback={<div className="h-7 w-24 rounded-control bg-surface-2" />}>
            <AccountBar />
          </Suspense>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Suspense fallback={<div className="hidden w-14 shrink-0 border-r border-line md:block lg:w-56" />}>
          <AppRail />
        </Suspense>

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="min-w-0 flex-1 px-3 py-4 md:px-5 md:py-5">
            <Suspense fallback={null}>
              <ResponsibleGuard />
            </Suspense>
            {children}
          </main>

          <footer className="border-t border-line px-3 py-5 md:px-5">
            <Suspense fallback={null}>
              <Disclaimer />
            </Suspense>
          </footer>
        </div>
      </div>

      <Suspense fallback={null}>
        <AppBottomBar initialLive={live} />
      </Suspense>
      <Suspense fallback={null}>
        <Tour telegram={telegramConfigured()} ai={aiConfigured()} />
      </Suspense>
    </div>
  );
}
