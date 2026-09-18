import { Suspense } from "react";
import { AlertsPanel } from "@/components/AlertsPanel";
import { AppPageHead } from "@/components/AppPageHead";

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={null}>
        <AppPageHead href="/app/alerts" />
      </Suspense>
      <AlertsPanel />
    </div>
  );
}
