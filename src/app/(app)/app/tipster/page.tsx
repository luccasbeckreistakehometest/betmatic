import { Suspense } from "react";
import { TipsterAudit } from "@/components/TipsterAudit";

export const dynamic = "force-dynamic";

export default function TipsterPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-panel bg-surface-1" />}>
      <TipsterAudit />
    </Suspense>
  );
}
