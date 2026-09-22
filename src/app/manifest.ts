import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/seo";

/**
 * The web app manifest: what lets a phone install Betmatic from the browser and open it without the
 * browser's chrome. Colours are the dark theme's page surface (docs/DESIGN.md §6.3) so the splash
 * and the status bar match the first paint; the icons are the mark on its own tile, in ink.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: "Preço, chance medida e a evidência por trás de cada bilhete.",
    lang: "pt-BR",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0c11",
    theme_color: "#0a0c11",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
