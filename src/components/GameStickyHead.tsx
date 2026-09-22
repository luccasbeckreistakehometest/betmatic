"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useLiveScore } from "@/components/game-stores";
import { cx } from "@/components/ui";
import type { Lang } from "@/lib/i18n";

interface Side { abbr: string; name: string; score?: number }

/**
 * The phone's compact game head: both teams, the score or the kickoff, the clock while the game is
 * on. It slides in under the topbar once the full team block has scrolled away and leaves again
 * when the block is back, so the page opens with the real head and keeps the short one while you
 * read tickets far below. Hidden from 768px up, where the topbar and the page head are enough.
 */
export function GameStickyHead({ away, home, status, live, kickoff, lang, backHref }: {
  away: Side;
  home: Side;
  /** The status line at render time: "Encerrado", "5:12 · 3º", a kickoff time. */
  status: string;
  live: boolean;
  kickoff: boolean;
  lang: Lang;
  backHref: string;
}) {
  const [shown, setShown] = useState(false);
  const polled = useLiveScore();

  useEffect(() => {
    const head = document.getElementById("game-head");
    if (!head || typeof IntersectionObserver === "undefined") return;
    // Observed against the viewport minus the topbar: the short head appears when the last pixel
    // of the full block passes under the bar, not when the block leaves the screen entirely.
    const observer = new IntersectionObserver(([entry]) => setShown(!entry.isIntersecting), { rootMargin: "-48px 0px 0px 0px", threshold: 0 });
    observer.observe(head);
    return () => observer.disconnect();
  }, []);

  const awayScore = polled?.away.score ?? away.score;
  const homeScore = polled?.home.score ?? home.score;
  const inPlay = polled ? polled.state === "in" : live;
  // "5:12 · 3º" while the game is on (Q3 in English); otherwise the status line the server rendered.
  const period = polled ? (lang === "pt" ? `${polled.period}º` : `Q${polled.period}`) : "";
  const clock = polled && polled.state === "in" ? `${polled.clock} · ${period}` : status;
  const showScore = !kickoff && awayScore !== undefined && homeScore !== undefined;

  return (
    <div
      data-testid="game-sticky-head"
      data-shown={shown ? "true" : "false"}
      aria-hidden={!shown}
      className={cx(
        "fixed inset-x-0 top-(--topbar-h) z-30 flex h-11 items-center gap-2 border-b border-line bg-surface-1 px-1 transition-[transform,opacity] duration-(--dur-2) ease-(--ease-out) md:hidden",
        shown ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0",
      )}
    >
      <Link href={backHref} aria-label={lang === "pt" ? "Voltar aos jogos" : "Back to the slate"} tabIndex={shown ? 0 : -1} className="grid size-11 shrink-0 place-items-center text-fg-muted">
        <Icon name="chevron-left" size={20} />
      </Link>
      <span className="flex min-w-0 flex-1 items-center justify-center gap-2 text-sm">
        <span className="truncate text-right text-fg" title={away.name}>{away.abbr}</span>
        {showScore ? (
          <span className="nums shrink-0 text-base text-fg" data-testid="sticky-score">{awayScore} × {homeScore}</span>
        ) : (
          <span aria-hidden="true" className="shrink-0 text-fg-dim">×</span>
        )}
        <span className="truncate text-fg" title={home.name}>{home.abbr}</span>
      </span>
      <span className={cx("flex shrink-0 items-center gap-1.5 text-label nums", inPlay ? "text-neg" : "text-fg-dim")}>
        {inPlay && <span aria-hidden="true" className="live-dot size-1.5 rounded-full bg-neg" />}
        {clock}
      </span>
    </div>
  );
}
