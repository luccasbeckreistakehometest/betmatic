import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { HtmlLang } from "@/components/HtmlLang";
import { publicBaseUrl } from "@/lib/base-url";
import { DEFAULT_META, DEFAULT_OG_IMAGE, SITE_NAME } from "@/lib/seo";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

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
  };
}

export const viewport: Viewport = {
  themeColor: "#08090c",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = await requestLang();
  return (
    <html lang={lang === "en" ? "en" : "pt-BR"} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Suspense fallback={null}>
          <HtmlLang fallback={lang} />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
