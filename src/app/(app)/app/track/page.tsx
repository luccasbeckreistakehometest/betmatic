import { Suspense } from "react";
import { TrackRecord } from "@/components/TrackRecord";
import { PanelSkeleton } from "@/components/AppPageHead";

export const dynamic = "force-dynamic";

export default function TrackPage() {
  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={<PanelSkeleton />}>
        <TrackRecord />
      </Suspense>
    </div>
  );
}
