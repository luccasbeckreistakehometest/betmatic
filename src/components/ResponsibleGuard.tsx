"use client";

import { useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/format";
import Link from "next/link";
import { useNavState } from "@/components/Controls";
import { makeT } from "@/lib/i18n";
import { reminderCount } from "@/lib/limits";

interface State { paused: boolean; until: string | null; minutes: number | null }
const START_KEY = "bm_session_start";
const SHOWN_KEY = "bm_reminder_shown";

/**
 * Sits in the app layout for signed-in users: the pause banner while a self-exclusion is active,
 * and the "you've been here N minutes" reminder on the interval the user chose. Session start is
 * per browser tab (sessionStorage) so a reload never resets the clock.
 */
export function ResponsibleGuard() {
  const { lang } = useNavState();
  const t = makeT(lang);
  const [state, setState] = useState<State | null>(null);
  const [reminder, setReminder] = useState<number | null>(null);
  // The reminder counts as seen only once it is dismissed: a remount (a client navigation right after
  // load) must not swallow one that was never on screen.
  const due = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => {
      fetch("/api/settings", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
        if (!j) return;
        setState({ paused: j.pause.paused, until: j.pause.until, minutes: j.settings.sessionReminderMinutes });
      }).catch(() => {});
    }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!state?.minutes) return;
    const minutes = state.minutes;
    const read = (k: string) => { try { return Number(sessionStorage.getItem(k) ?? 0); } catch { return 0; } };
    const write = (k: string, v: number) => { try { sessionStorage.setItem(k, String(v)); } catch { /* private mode */ } };
    if (!read(START_KEY)) write(START_KEY, Date.now());
    const check = () => {
      const start = read(START_KEY) || Date.now();
      const n = reminderCount(start, minutes, Date.now());
      if (n > read(SHOWN_KEY)) { due.current = n; setReminder(Math.round((Date.now() - start) / 60_000)); }
    };
    const first = setTimeout(check, 50);
    const every = setInterval(check, 30_000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [state?.minutes]);

  if (!state) return null;
  return (
    <>
      {state.paused && state.until && (
        <div className="mx-auto mb-4 w-full max-w-7xl rounded-panel border border-warn bg-warn-tint px-4 py-2.5 text-sm text-warn" data-testid="pause-banner">
          {t("pausedBlock").replace("{date}", formatDate(state.until, lang, { year: true }))}{" "}
          <Link href={{ pathname: "/app/settings", query: { lang } }} className="underline underline-offset-2">{t("navSettings")}</Link>
        </div>
      )}
      {reminder !== null && (
        <div className="fixed right-5 bottom-(--float-b) z-[80] w-[min(92vw,340px)] rounded-panel border border-line-strong bg-surface-1 p-4 shadow-pop" data-testid="session-reminder">
          <p className="text-base font-semibold text-fg">{t("sessionReminder").replace("{n}", String(reminder))}</p>
          <p className="mt-1 text-tiny text-fg-dim">{t("notInvestment")}</p>
          <button onClick={() => { try { sessionStorage.setItem(SHOWN_KEY, String(due.current)); } catch { /* private mode */ } setReminder(null); }} className="mt-3 rounded-control border border-line-control px-3 py-1.5 text-tiny text-fg-muted hover:text-fg" data-testid="reminder-dismiss">{t("dismiss")}</button>
        </div>
      )}
    </>
  );
}
