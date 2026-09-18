import { Suspense } from "react";
import { WeeklyReport } from "@/components/WeeklyReport";
import { PanelSkeleton } from "@/components/AppPageHead";

export const dynamic = "force-dynamic";

export default function ReportPage() {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <WeeklyReport />
    </Suspense>
  );
}
