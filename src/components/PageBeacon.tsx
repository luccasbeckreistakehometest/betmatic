"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { pageEvent } from "@/lib/analytics/events";
import { track } from "@/lib/track";

/** One page_view per route change, plus the funnel name the page stands for. Sets no state. */
export function PageBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin") || pathname.startsWith("/api")) return;
    track("page_view");
    const named = pageEvent(pathname);
    if (named) track(named);
  }, [pathname]);
  return null;
}
