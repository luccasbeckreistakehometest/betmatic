/**
 * Betmatic mark: a "B" built from four stacked bars of different lengths — a probability
 * distribution read as a letter. Drawn on an 8px grid so it stays crisp at 20px in a nav bar,
 * and monochrome so it survives a favicon, a dark header and a printed page.
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
      <rect width="32" height="32" rx="7" fill="currentColor" />
      {/* Four bars rising then falling: a payout ladder and a distribution at once. Left edges
          align so it stays legible at favicon size. */}
      <rect x="7" y="6.5" width="8" height="4" rx="2" fill="var(--logo-ink, #08090c)" />
      <rect x="7" y="12.5" width="14" height="4" rx="2" fill="var(--logo-ink, #08090c)" />
      <rect x="7" y="18.5" width="19" height="4" rx="2" fill="var(--logo-ink, #08090c)" />
      <rect x="7" y="24.5" width="11" height="4" rx="2" fill="var(--logo-ink, #08090c)" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-baseline gap-[1px] font-semibold tracking-[-0.03em] ${className}`}>
      <span>bet</span>
      <span className="text-edge-400">matic</span>
    </span>
  );
}

export function Logo({ size = 28, showWord = true }: { size?: number; showWord?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={size} className="text-edge-400" />
      {showWord && <Wordmark className="text-[16px] text-mist-100" />}
    </span>
  );
}
