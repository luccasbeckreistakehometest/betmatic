import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { NavLinks, SportPicker } from "@/components/Controls";
import { Disclaimer } from "@/components/Disclaimer";
import { Logo } from "@/components/Logo";
import { AccountBar } from "@/components/AccountBar";
import { Tour } from "@/components/Tour";
import { ResponsibleGuard } from "@/components/ResponsibleGuard";
import { telegramConfigured } from "@/lib/server/telegram";
import { aiConfigured } from "@/lib/ai/client";

// The logged-in app is private: nothing under /app belongs in a search index.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-ink-800 bg-ink-950/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 sm:gap-4 sm:px-5">
          <Link href="/app" className="group flex shrink-0 items-center" aria-label="Betmatic">
            <span className="sm:hidden"><Logo size={26} showWord={false} /></span>
            <span className="hidden sm:inline"><Logo size={28} /></span>
          </Link>
          {/* useSearchParams needs a Suspense boundary when rendered from a server layout. */}
          <Suspense fallback={<div className="h-8 w-28 rounded-lg bg-ink-850" />}>
            <SportPicker className="min-w-0" />
          </Suspense>
          <Suspense fallback={null}>
            <NavLinks />
          </Suspense>
          <div className="ml-auto flex shrink-0 items-center">
            <Suspense fallback={<div className="h-8 w-24 rounded-lg bg-ink-850" />}>
              <AccountBar />
            </Suspense>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-5">
        <Suspense fallback={null}>
          <ResponsibleGuard />
        </Suspense>
        {children}
      </main>
      <Suspense fallback={null}>
        <Tour telegram={telegramConfigured()} ai={aiConfigured()} />
      </Suspense>

      <footer className="border-t border-ink-800 px-4 py-5 sm:px-5">
        <Suspense fallback={null}>
          <Disclaimer />
        </Suspense>
      </footer>
    </>
  );
}
