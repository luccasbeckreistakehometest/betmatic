import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SessionBar } from "@/components/SessionBar";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "NBA Edge — betting research desk",
  description: "Slate view, insider reporting, prop tools and picks, gathered per game.",
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
                NBA Edge
              </span>
            </Link>
            <span className="hidden text-xs text-mist-500 sm:block">research desk</span>
            <div className="ml-auto">
              <SessionBar />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-6">{children}</main>

        <footer className="border-t border-ink-800 px-5 py-5">
          <div className="mx-auto flex max-w-7xl flex-col gap-1.5 text-xs text-mist-500">
            <p>
              Research tool. Aggregated data can be wrong, stale, or contradictory — verify a line at your
              book before acting on anything here. Nothing on this page is betting advice.
            </p>
            <p>
              21+ where applicable. If betting stops being fun, that&apos;s the signal to stop —
              1-800-GAMBLER.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
