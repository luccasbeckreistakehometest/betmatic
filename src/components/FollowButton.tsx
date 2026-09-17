"use client";

import Link from "next/link";
import { useState } from "react";
import { useNavState } from "@/components/Controls";
import { makeT } from "@/lib/i18n";

/** One click on a game page follows a team; the alerts page lists and removes them. */
export function FollowButton({ sportKey, teamId, label, initial, signedIn }: { sportKey: string; teamId: string; label: string; initial: boolean; signedIn: boolean }) {
  const { lang } = useNavState();
  const t = makeT(lang);
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  if (!signedIn) return <Link href="/login" className="text-[11px] text-mist-500 hover:text-mist-300">{t("follow")}</Link>;
  async function toggle() {
    setBusy(true);
    try {
      const r = await fetch("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: on ? "unfollow" : "follow", kind: "team", sportKey, key: teamId, label }) });
      if (r.ok) setOn(!on);
    } finally { setBusy(false); }
  }
  return (
    <button onClick={() => void toggle()} disabled={busy} data-testid={`follow-${teamId}`} data-on={on ? "1" : "0"}
      className={`rounded border px-2 py-0.5 text-[11px] transition ${on ? "border-edge-400/50 bg-edge-400/10 text-edge-400" : "border-ink-700 text-mist-400 hover:border-ink-600 hover:text-mist-100"}`}>
      {on ? t("followingLabel") : t("follow")}
    </button>
  );
}
