"use client";

import { useEffect, useState } from "react";
import { usePageActions } from "@/components/game-stores";
import { Button } from "@/components/ui";

/**
 * The phone's action bar: one primary button, fixed just above the tab bar, showing whichever
 * action the page's regions offered with the highest priority — as long as the inline control
 * that does the same thing is off screen. A view keeps one primary action (§14): when the inline
 * button scrolls into view the bar steps aside, and when the region withdraws its action the bar
 * leaves. Nothing on a desk: the actions are in the panels, where a mouse already is.
 */
export function GameActionBar() {
  const actions = usePageActions();
  // Per action: has the observer seen its inline control off screen? Unknown until it reports, so
  // the bar never flashes on load in front of a button that is already visible.
  const [offscreen, setOffscreen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || !actions.length) return;
    const observer = new IntersectionObserver((entries) => {
      setOffscreen((prev) => {
        const next = { ...prev };
        for (const entry of entries) next[(entry.target as HTMLElement).dataset.actionAnchor ?? ""] = !entry.isIntersecting;
        return next;
      });
    }, { rootMargin: "0px 0px -56px 0px", threshold: 0 });
    const seen: HTMLElement[] = [];
    for (const action of actions) {
      const el = action.anchor() as HTMLElement | null;
      if (!el) continue;
      el.dataset.actionAnchor = action.id;
      observer.observe(el);
      seen.push(el);
    }
    return () => {
      observer.disconnect();
      for (const el of seen) delete el.dataset.actionAnchor;
    };
  }, [actions]);

  // An action without an inline twin is always offered; one with a twin only while it is off screen.
  const action = actions.find((a) => offscreen[a.id] === true || (offscreen[a.id] === undefined && a.anchor() === null));
  if (!action) return null;
  return (
    <div
      data-testid="game-action-bar"
      className="fixed inset-x-0 bottom-(--tabbar-h) z-20 border-t border-line bg-surface-1 px-4 py-2 md:hidden"
    >
      <Button variant="primary" onClick={action.run} loading={action.busy} data-testid={action.testId ?? "action-bar-primary"} className="w-full">
        {action.label}
      </Button>
    </div>
  );
}
