import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountPanel } from "@/components/AccountPanel";
import { langFrom, type SearchProps } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: SearchProps): Promise<Metadata> {
  return { title: (await langFrom(searchParams)) === "en" ? "My account" : "Minha conta" };
}

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-ink-900" />}>
      <AccountPanel />
    </Suspense>
  );
}
