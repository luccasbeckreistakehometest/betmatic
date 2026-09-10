import { Suspense } from "react";
import { ParlayBuilder } from "@/components/ParlayBuilder";

export const dynamic = "force-dynamic";

export default function ParlaysPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-ink-900" />}>
      <ParlayBuilder />
    </Suspense>
  );
}
