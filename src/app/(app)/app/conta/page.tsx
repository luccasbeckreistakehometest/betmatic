import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountPanel } from "@/components/AccountPanel";
import { langFrom, type SearchProps } from "@/lib/seo";
import { AppPageHead, PanelSkeleton } from "@/components/AppPageHead";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: SearchProps): Promise<Metadata> {
  return { title: (await langFrom(searchParams)) === "en" ? "My account" : "Minha conta" };
}

export default function AccountPage() {
  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={null}>
        <AppPageHead href="/app/conta" />
      </Suspense>
      <Suspense fallback={<PanelSkeleton />}>
        <AccountPanel />
      </Suspense>
    </div>
  );
}
