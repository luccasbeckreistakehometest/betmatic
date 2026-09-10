import { Suspense } from "react";
import { SlipBuilder } from "@/components/SlipBuilder";

export const dynamic = "force-dynamic";

export default function SlipPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-ink-900" />}>
      <SlipBuilder />
    </Suspense>
  );
}
