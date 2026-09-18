import { Suspense } from "react";
import { ReferralPanel } from "@/components/ReferralPanel";
import { AppPageHead } from "@/components/AppPageHead";

export const dynamic = "force-dynamic";

export default function ReferralPage() {
  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={null}>
        <AppPageHead href="/app/referral" />
      </Suspense>
      <ReferralPanel />
    </div>
  );
}
