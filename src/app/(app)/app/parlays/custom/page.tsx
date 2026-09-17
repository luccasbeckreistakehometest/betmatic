import { Suspense } from "react";
import { CustomParlay } from "@/components/CustomParlay";

export const dynamic = "force-dynamic";

export default function CustomParlayPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-ink-900" />}>
      <CustomParlay />
    </Suspense>
  );
}
