import { Suspense } from "react";
import { ParlayBuilder } from "@/components/ParlayBuilder";
import { AppPageHead, PanelSkeleton } from "@/components/AppPageHead";

export const dynamic = "force-dynamic";

export default function ParlaysPage() {
  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={null}><AppPageHead href="/app/parlays" /></Suspense>
      <Suspense fallback={<PanelSkeleton />}>
        <ParlayBuilder />
      </Suspense>
    </div>
  );
}
