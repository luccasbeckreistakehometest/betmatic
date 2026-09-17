import { Suspense } from "react";
import { TipsterAudit } from "@/components/TipsterAudit";

export const dynamic = "force-dynamic";

export default function TipsterPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-ink-900" />}>
      <TipsterAudit />
    </Suspense>
  );
}
