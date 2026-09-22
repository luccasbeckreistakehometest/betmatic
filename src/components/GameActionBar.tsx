"use client";

import { useEffect, useState } from "react";
import { usePageActions } from "@/components/game-stores";
import { Button, cx } from "@/components/ui";

/**
 * The phone's action bar: one primary button for the page's state — the action the page's regions
 * offered with the highest priority, and only that one. It shows while the inline control that does
 * the same thing is off screen and steps aside as soon as that control is in view, so the screen
 * never carries the same primary action twice (§14); it never falls through to a lesser action, so
 * its label cannot change under a scrolling thumb.
 *
 * It is the last element of the page and sticks to the bottom of the viewport, above the tab bar,
 * for as long as its own place in the page is below the fold; at the end of the page it rests in
 * flow, above the footer, so the responsible-gambling line is never covered. Its place in the page
 * stays while an action exists and only its visibility follows the anchor, so the page's height
 * never changes under a scrolling thumb. Nothing on a desk: the actions are in the panels, where a
 * pointer already is.
 */
export function GameActionBar() {
  const actions = usePageActions();
  const action = actions[0] ?? null;
  // Has the observer seen the action's inline control off screen? Unknown until it reports, so the
  // bar never flashes on load in front of a button that is already visible.
  const [offscreen, setOffscreen] = useState<{ id: string; value: boolean } | null>(null);

  const id = action?.id ?? null;
  useEffect(() => {
    if (!action || typeof IntersectionObserver === "undefined") return;
    const el = action.anchor();
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setOffscreen({ id: action.id, value: !entry.isIntersecting }),
      // The bottom 57px are under the tab bar: a control there is not in view.
      { rootMargin: "0px 0px -57px 0px", threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // The observed element is the action's anchor; re-run when the offered action changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!action) return null;
  const known = offscreen && offscreen.id === action.id ? offscreen.value : null;
  const shown = !action.pending && (known === true || (known === null && action.anchor() === null));
  return (
    <div
      data-testid="game-action-bar"
      data-shown={shown ? "true" : "false"}
      aria-hidden={!shown}
      className={cx("sticky bottom-(--tabbar-h) z-20 -mx-3 border-t border-line bg-surface-1 px-4 py-2 md:hidden", !shown && "invisible")}
    >
      {!action.pending && (
        <Button variant="primary" onClick={action.run} loading={action.busy} data-testid={action.testId ?? "action-bar-primary"} className="w-full">
          {action.label}
        </Button>
      )}
    </div>
  );
}
