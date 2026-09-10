import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import { SessionBar } from "@/components/SessionBar";
import { LangPicker, NavLinks, SportPicker } from "@/components/Controls";
import { Disclaimer } from "@/components/Disclaimer";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Edge — betting research desk",
  description: "Basketball, soccer and tennis: slate view, insider reporting, measured player props and ticket building.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-40 border-b border-ink-800 bg-ink-950/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3">
            <Link href="/" className="group flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-signal-500 to-edge-500 text-[13px] font-bold text-ink-950">
                NE
              </span>
              <span className="text-[15px] font-semibold tracking-tight text-mist-100 group-hover:text-white">
                Edge
              </span>
            </Link>
            {/* useSearchParams needs a Suspense boundary when rendered from a server layout. */}
            <Suspense fallback={<div className="h-8 w-36 rounded-lg bg-ink-850" />}>
              <SportPicker />
            </Suspense>
            <Suspense fallback={<div className="h-6 w-40 rounded-lg bg-ink-850" />}>
              <NavLinks />
            </Suspense>
            <div className="ml-auto flex items-center gap-3">
              <SessionBar />
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
      </body>
    </html>
  );
}
