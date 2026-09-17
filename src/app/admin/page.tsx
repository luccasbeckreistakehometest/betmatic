import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminDashboard } from "@/components/AdminDashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-ink-900" />}>
      <AdminDashboard />
    </Suspense>
  );
}
