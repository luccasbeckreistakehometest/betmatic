import { Suspense } from "react";
import { TrackRecord } from "@/components/TrackRecord";

export const dynamic = "force-dynamic";

export default function TrackPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-panel bg-surface-1" />}>
      <TrackRecord />
    </Suspense>
  );
}
