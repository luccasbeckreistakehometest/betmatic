"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Dialog, Sheet, useIsPhone } from "@/components/ui";

/**
 * A dismissable overlay in the shape the device asks for: a bottom sheet on a phone, a centred
 * dialog on a desk. Both are the native <dialog> (src/components/ui-client.tsx), so the focus trap,
 * Esc and the return of focus to the trigger come from the platform rather than from us.
 *
 * Two details are taken from AppMenu, which is the pattern this follows:
 *
 *  · It renders into a portal at the end of <body>, never where it was written. A modal's heading
 *    must not come before the page's own title in the document, because that is the order a screen
 *    reader walks and the order a document query returns.
 *  · Opening pushes a history entry at the same URL, and every way out goes through one pop, so the
 *    phone's back gesture dismisses the overlay instead of leaving the page.
 *
 * Nothing is mounted until the reader opens it once — a page with eight tickets would otherwise
 * carry eight hidden dialogs — and it stays mounted afterwards, because the platform only returns
 * focus to the trigger when the element it closes is still there.
 */

/** The client is the client for as long as it lives: nothing to subscribe to. */
const subscribeToNothing = () => () => {};

export function Modal({ open, onClose, title, closeLabel, testId, footer, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  testId?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const phone = useIsPhone();
  /** A portal needs a document, and the server has none; the same shape useIsPhone uses. */
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  /** Nothing is built until the reader asks for it once; see the note above. Adjusting state while
   *  rendering is the pattern React documents for state that follows a prop, and it costs one extra
   *  render on the open — not an effect, which would paint the page before the sheet exists. */
  const [everOpened, setEverOpened] = useState(open);
  if (open && !everOpened) setEverOpened(true);
  /** True while the history entry this overlay pushed is the one on top. */
  const owned = useRef(false);

  /**
   * The latest onClose, so the listener below can be registered once and never replaced.
   *
   * This is not a micro-optimisation, it is the whole reason the sheet closes: a listener removed
   * while an event is being dispatched is never called, and Next's own popstate handler re-renders
   * the tree from inside that dispatch (app-router.js dispatches a traverse). A listener that
   * re-subscribes on every render is therefore torn down mid-flight and misses the very pop it was
   * waiting for — which is exactly what a phone's back gesture produces.
   */
  const latest = useRef(onClose);
  useEffect(() => { latest.current = onClose; });

  // Always listening, never tied to `open`: the pop is what closes the overlay, so the handler has
  // to outlive the closing it causes. `owned` is the guard, so an unrelated back is left alone.
  useEffect(() => {
    const onPop = () => {
      if (!owned.current) return;
      owned.current = false;
      latest.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (open && !owned.current) {
      // No URL, on purpose. Next patches pushState, and a patched push that is GIVEN a url — even
      // the one already in the bar — dispatches a router restore; on a page whose panel sits behind
      // a Suspense boundary that restore throws the subtree's state away, which took the sheet down
      // with it the instant it opened. Omitting the url pushes an entry at the same address and
      // still copies Next's own internal state onto it, so the pop is an ordinary traverse.
      window.history.pushState({ betmaticModal: true }, "");
      owned.current = true;
      return;
    }
    // Closed by its owner rather than by a dismissal: the entry still has to come off the stack.
    if (!open && owned.current) {
      owned.current = false;
      window.history.back();
    }
  }, [open]);

  /** The one way out. Esc, the backdrop and the close button all come through here. */
  const close = useCallback(() => {
    if (!owned.current) { onClose(); return; }
    window.history.back();
  }, [onClose]);

  const Shell = phone ? Sheet : Dialog;
  if (!mounted || !everOpened) return null;
  return createPortal(
    <Shell open={open} onClose={close} title={title} closeLabel={closeLabel} footer={footer}>
      <div data-testid={testId}>{children}</div>
    </Shell>,
    document.body,
  );
}
