import { Suspense } from "react";
import { WeeklyReport } from "@/components/WeeklyReport";

export const dynamic = "force-dynamic";

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-panel bg-surface-1" />}>
      <WeeklyReport />
    </Suspense>
  );
}
