import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { SportPicker } from "@/components/Controls";
import { AppBottomBar, AppRail } from "@/components/AppRail";
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
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col" data-density="default">
      <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface-1 px-3 md:px-4">
        <Link href="/app" className="flex shrink-0 items-center" aria-label="Betmatic">
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
        <AppBottomBar />
      </Suspense>
      <Suspense fallback={null}>
        <Tour telegram={telegramConfigured()} ai={aiConfigured()} />
      </Suspense>
    </div>
  );
}
