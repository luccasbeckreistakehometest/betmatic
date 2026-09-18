import { Suspense } from "react";
import { CustomParlay } from "@/components/CustomParlay";
import { PanelSkeleton } from "@/components/AppPageHead";

export const dynamic = "force-dynamic";

export default function CustomParlayPage() {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <CustomParlay />
    </Suspense>
  );
}
