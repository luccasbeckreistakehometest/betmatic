import { Suspense } from "react";
import { SlipBuilder } from "@/components/SlipBuilder";
import { AppPageHead, PanelSkeleton } from "@/components/AppPageHead";

export const dynamic = "force-dynamic";

export default function SlipPage() {
  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={null}><AppPageHead href="/app/slip" /></Suspense>
      <Suspense fallback={<PanelSkeleton />}>
        <SlipBuilder />
      </Suspense>
    </div>
  );
}
