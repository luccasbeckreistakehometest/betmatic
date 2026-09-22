"use client";

import { useLinkStatus } from "next/link";
import { Icon } from "@/components/Icon";

/**
 * The trailing glyph of a card that is a link: a chevron at rest, a spinner while the navigation it
 * started is pending. Tapping a game must never be silent — the page it opens is rendered on the
 * server, and on a slow connection nothing else would move until it arrives. Rendered inside the
 * <Link>, which is where useLinkStatus reads the pending state from.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  if (pending) {
    return <span aria-hidden="true" className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-fg-dim border-t-transparent" />;
  }
  return <Icon name="chevron-right" size={20} className="shrink-0 text-fg-dim" />;
}
