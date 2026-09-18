import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DesignGallery } from "@/components/DesignGallery";
import { requireAdmin } from "@/lib/server/session";

/**
 * The system, rendered. Every primitive in every state, at three densities and both themes — the
 * page a reviewer opens instead of reading docs/DESIGN.md, and the page that proves a token change
 * did not quietly break a state.
 *
 * Operator-only: it is a workbench, not a product surface, so it never renders for a visitor. It is
 * also noindex here and disallowed in robots.ts, and it is not in the sitemap.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false },
};

export default async function DesignPage() {
  if (!(await requireAdmin())) notFound();
  return <DesignGallery />;
}
