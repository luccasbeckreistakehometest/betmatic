import { Suspense } from "react";
import { SettingsPanel } from "@/components/SettingsPanel";
import { AppPageHead } from "@/components/AppPageHead";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={null}>
        <AppPageHead href="/app/settings" />
      </Suspense>
      <SettingsPanel />
    </div>
  );
}
