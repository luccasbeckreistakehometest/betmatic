"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";
import { Tr } from "@/components/ui";

/**
 * A table row that is one tap target for its game. The row's first cell already carries the only
 * link (the accessible name, the keyboard path); this makes the rest of the line go to the same
 * place. A stretched pseudo-element cannot do it: `position: relative` on a table row is ignored by
 * Safari, so the stretch only ever covered the first cell. Clicks on a control inside the row, and
 * modified clicks (new tab, text selection), are left alone.
 */
export function GameRow({ href, className = "", children, ...rest }: ComponentProps<typeof Tr> & { href: string }) {
  const router = useRouter();
  const onClick = (e: MouseEvent<HTMLTableRowElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.closest("a, button, input, select, textarea, label")) return;
    if (window.getSelection()?.toString()) return;
    router.push(href);
  };
  return (
    <Tr {...rest} onClick={onClick} className={`cursor-pointer ${className}`} data-testid="game-row">
      {children}
    </Tr>
  );
}
