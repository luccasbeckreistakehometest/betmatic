/**
 * Betmatic mark: a "B" built from four stacked bars of different lengths — a probability
 * distribution read as a letter. Drawn on an 8px grid so it stays crisp at 20px in a nav bar.
 *
 * It carries no hue, and that is a rule rather than a taste: a green brand on a betting product
 * implies profit, which Brazilian advertising rules forbid (docs/DESIGN.md §6.2). The square takes
 * the current ink and the bars are punched out of it in the page's own ground, so the mark is
 * legible in both themes, in a favicon and on paper.
 */
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size * 1.09}
      viewBox="0 0 32 35"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="6" fill="currentColor" />
      {/* Four bars rising then falling: a payout ladder and a distribution at once. Left edges
          align so it stays legible at favicon size. */}
      <rect x="7" y="6.5" width="8" height="4" rx="1" fill="var(--surface-0, #08090c)" />
      <rect x="7" y="12.5" width="14" height="4" rx="1" fill="var(--surface-0, #08090c)" />
      <rect x="7" y="18.5" width="19" height="4" rx="1" fill="var(--surface-0, #08090c)" />
      <rect x="7" y="24.5" width="11" height="4" rx="1" fill="var(--surface-0, #08090c)" />
    </svg>
  );
}

/** The wordmark is one voice at two weights, never two colours. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`u-title flex items-baseline tracking-[-0.02em] ${className}`}>
      <span className="text-fg">bet</span>
      <span className="text-fg-dim">matic</span>
    </span>
  );
}

export function Logo({ size = 28, showWord = true }: { size?: number; showWord?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark size={size} className="text-fg" />
      {showWord && <Wordmark className="text-base" />}
    </span>
  );
}
