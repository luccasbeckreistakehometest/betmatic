import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminDashboard } from "@/components/AdminDashboard";
import { PanelSkeleton } from "@/components/AppPageHead";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <AdminDashboard />
    </Suspense>
  );
}
