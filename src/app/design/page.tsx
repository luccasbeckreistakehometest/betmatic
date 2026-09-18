import type { Metadata } from "next";
import { DesignGallery } from "@/components/DesignGallery";

/**
 * The system, rendered. Every primitive in every state, at three densities and both themes — the
 * page a reviewer opens instead of reading docs/DESIGN.md, and the page that proves a token change
 * did not quietly break a state. Not in the sitemap, disallowed in robots.txt, noindex here.
 */
export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false },
};

export default function DesignPage() {
  return <DesignGallery />;
}
