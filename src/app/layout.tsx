import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { HtmlLang } from "@/components/HtmlLang";
import { PageBeacon } from "@/components/PageBeacon";
import { publicBaseUrl } from "@/lib/base-url";
import { DEFAULT_META, DEFAULT_OG_IMAGE, SITE_NAME } from "@/lib/seo";
import "./globals.css";

/**
 * Three families, self-hosted by next/font (no CDN). Reasons in docs/DESIGN.md §3; the subsets are
 * a measured decision, not a default (§3.4): the Latin subset already carries every Portuguese
 * diacritic, so only the face that sets feed names — Plex Sans, which renders every team and
 * player string — pays for latin-ext. Measured first paint: 217 KB of woff2 against a 260 KB
 * budget; with latin-ext on all three it was 327 KB.
 * adjustFontFallback (default) writes the metric overrides, so first paint does not shift.
 */
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"], display: "swap" });
const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin", "latin-ext"], axes: ["wdth"], display: "swap" });
// Plex Mono has no variable build on Google Fonts: three static weights, and never above 32px.
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

/**
 * Theme before paint: the product works in dark, and an explicit choice is remembered. A blocking
 * inline script, because a flash of the wrong palette is worse than 300 bytes. It is server-rendered
 * once per document, which is the only time it needs to run.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("bm-theme");var d=document.documentElement;if(t==="light"||t==="dark"){d.dataset.theme=t}else if(t==="system"){delete d.dataset.theme}var n=localStorage.getItem("bm-density");if(n==="compact"||n==="comfortable"||n==="default"){d.dataset.density=n}}catch(e){}`;

async function requestLang(): Promise<"pt" | "en"> {
  return (await headers()).get("x-bm-lang") === "en" ? "en" : "pt";
}

export async function generateMetadata(): Promise<Metadata> {
  const lang = await requestLang();
  const meta = DEFAULT_META[lang];
  return {
    // Absolute URLs for Open Graph images and canonicals: behind Caddy the request host is internal.
    metadataBase: new URL(publicBaseUrl()),
    title: { default: meta.title, template: `%s · ${SITE_NAME}` },
    description: meta.description,
    applicationName: SITE_NAME,
    openGraph: {
      siteName: SITE_NAME,
      title: meta.title,
      description: meta.description,
      locale: lang === "pt" ? "pt_BR" : "en_US",
      type: "website",
      images: [DEFAULT_OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title: meta.title, description: meta.description, images: [DEFAULT_OG_IMAGE.url] },
    // Installed from the home screen the app opens without the browser's chrome; the manifest
    // (src/app/manifest.ts) says the same to Android and desktop Chrome.
    appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "black-translucent" },
    formatDetection: { telephone: false },
  };
}

/** The palette is owned by globals.css, which sets `color-scheme` per theme; this only tells the
 *  browser both are supported, so a light reader does not get dark scrollbars. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0c11" },
  ],
  colorScheme: "dark light",
  // The page runs edge to edge on a phone with a notch; the safe-area insets are read in globals.css.
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = await requestLang();
  return (
    <html
      lang={lang === "en" ? "en" : "pt-BR"}
      data-theme="dark"
      data-density="default"
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-surface-0 text-fg">
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <Suspense fallback={null}>
          <HtmlLang fallback={lang} />
        </Suspense>
        <Suspense fallback={null}>
          <PageBeacon />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
