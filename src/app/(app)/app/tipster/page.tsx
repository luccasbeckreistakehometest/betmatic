import { Suspense } from "react";
import { TipsterAudit } from "@/components/TipsterAudit";
import { PanelSkeleton } from "@/components/AppPageHead";

export const dynamic = "force-dynamic";

export default function TipsterPage() {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <TipsterAudit />
    </Suspense>
  );
}
