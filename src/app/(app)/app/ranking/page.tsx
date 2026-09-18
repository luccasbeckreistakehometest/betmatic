import { Suspense } from "react";
import { LeaderboardPanel } from "@/components/LeaderboardPanel";
import { AppPageHead } from "@/components/AppPageHead";

export const dynamic = "force-dynamic";

export default function LeaderboardPage() {
  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={null}>
        <AppPageHead href="/app/ranking" />
      </Suspense>
      <LeaderboardPanel />
    </div>
  );
}
