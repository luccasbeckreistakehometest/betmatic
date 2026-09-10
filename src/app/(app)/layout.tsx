import Link from "next/link";
import { Suspense } from "react";
import { LangPicker, NavLinks, SportPicker } from "@/components/Controls";
import { Disclaimer } from "@/components/Disclaimer";
import { Logo } from "@/components/Logo";
import { AccountBar } from "@/components/AccountBar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-ink-800 bg-ink-950/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3">
            <Link href="/app" className="group flex items-center">
              <Logo size={28} />
            </Link>
            {/* useSearchParams needs a Suspense boundary when rendered from a server layout. */}
            <Suspense fallback={<div className="h-8 w-36 rounded-lg bg-ink-850" />}>
              <SportPicker />
            </Suspense>
            <Suspense fallback={<div className="h-6 w-40 rounded-lg bg-ink-850" />}>
              <NavLinks />
            </Suspense>
            <div className="ml-auto flex items-center gap-3">
              <AccountBar />
              <Suspense fallback={<div className="h-6 w-14 rounded-lg bg-ink-850" />}>
                <LangPicker />
              </Suspense>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-6">{children}</main>

        <footer className="border-t border-ink-800 px-5 py-5">
          <Suspense fallback={null}>
            <Disclaimer />
          </Suspense>
        </footer>
    </>
  );
}
