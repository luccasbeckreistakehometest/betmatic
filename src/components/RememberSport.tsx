"use client";

import { useEffect } from "react";

/** Remembers the last sport for a year so /app reopens on it. A cookie, not state: nothing re-renders. */
export function RememberSport({ sportKey }: { sportKey: string }) {
  useEffect(() => {
    try {
      document.cookie = `bm_sport=${encodeURIComponent(sportKey)}; path=/; max-age=${365 * 86_400}; samesite=lax`;
    } catch {
      // Cookies blocked: the app falls back to a sport with games today.
    }
  }, [sportKey]);
  return null;
}
