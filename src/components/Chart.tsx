import type { ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * The one chart grammar in the product (docs/DESIGN.md §11.3). Everything that draws a series goes
 * through here, so a curve on /app/bankroll and a curve on /prova are the same object:
 *
 *   · a fixed 16:6 frame, so two screenshots of it are comparable;
 *   · three to five round-number y ticks on hairlines, never a decorative grid;
 *   · a zero line that is always drawn, one step stronger than a tick;
 *   · a 1.5px line in ink, tinted pos/neg only where the series encodes gain and loss, split at
 *     the zero crossing by a clip — not by colouring whole segments, which lies about where the
 *     crossing happened;
 *   · points only while there are few enough to be points (n ≤ 30);
 *   · and a table twin for a screen reader, because a path with an aria-label is not a chart.
 */

const W = 640;
const H = 240;
const PAD = { top: 12, right: 10, bottom: 24, left: 48 };

/** A round step: 1, 2, 2.5 or 5 times a power of ten, so the ticks read as numbers a person says. */
function niceStep(span: number, count: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const raw = span / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

export function chartTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  const step = niceStep(hi - lo || 1, count);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step / 1000; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (!out.includes(0)) out.push(0);
  return out.sort((a, b) => a - b);
}

export type ChartPoint = { x: number; value: number; label: string; href?: string; title?: string };

export function LineChart({
  points,
  formatValue,
  caption,
  signed = true,
  firstLabel,
  lastLabel,
  footer,
  testId,
  className = "",
}: {
  /** In series order; x is ignored and the index is used, because the ledger is a sequence. */
  points: ChartPoint[];
  formatValue: (value: number) => string;
  /** Read by the screen-reader table and used as the figure's accessible name. */
  caption: string;
  /** False for a series that is only ever positive (a count, a price): then the line stays ink. */
  signed?: boolean;
  firstLabel?: string;
  lastLabel?: string;
  footer?: ReactNode;
  testId?: string;
  className?: string;
}) {
  const values = [0, ...points.map((p) => p.value)];
  const ticks = chartTicks(Math.min(...values), Math.max(...values));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const span = hi - lo || 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const xOf = (i: number) => PAD.left + (values.length > 1 ? (i / (values.length - 1)) * innerW : innerW / 2);
  const yOf = (v: number) => PAD.top + (1 - (v - lo) / span) * innerH;
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(2)},${yOf(v).toFixed(2)}`).join(" ");
  const zeroY = yOf(0);
  const dots = points.length <= 30;
  const id = testId ?? "chart";

  return (
    <figure className={cx("m-0 max-w-[46rem]", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full max-w-full"
        role="img"
        aria-label={caption}
        data-testid={`${id}-svg`}
      >
        <defs>
          {/* Above and below zero are two clips over one path: the crossing lands where it lands. */}
          <clipPath id={`${id}-above`}>
            <rect x="0" y="0" width={W} height={Math.max(0, zeroY)} />
          </clipPath>
          <clipPath id={`${id}-below`}>
            <rect x="0" y={zeroY} width={W} height={Math.max(0, H - zeroY)} />
          </clipPath>
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yOf(tick)}
              y2={yOf(tick)}
              stroke={tick === 0 ? "var(--line-strong)" : "var(--line)"}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={PAD.left - 8}
              y={yOf(tick) + 3.5}
              textAnchor="end"
              fontSize={10}
              fontFamily="var(--font-mono)"
              fill="var(--fg-dim)"
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}

        <path
          d={d}
          fill="none"
          stroke={signed ? "var(--pos)" : "var(--fg)"}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          clipPath={signed ? `url(#${id}-above)` : undefined}
          data-testid={`${id}-path`}
        />
        {signed && (
          <path d={d} fill="none" stroke="var(--neg)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${id}-below)`} />
        )}

        {dots &&
          points.map((p, i) => {
            const cx2 = xOf(i + 1);
            const cy = yOf(p.value);
            const dot = (
              <circle
                cx={cx2}
                cy={cy}
                r={2.5}
                fill="var(--surface-1)"
                stroke={signed ? (p.value >= 0 ? "var(--pos)" : "var(--neg)") : "var(--fg)"}
                strokeWidth={1.5}
              >
                <title>{p.title ?? `${p.label}: ${formatValue(p.value)}`}</title>
              </circle>
            );
            return p.href ? (
              <a key={`${p.label}-${i}`} href={p.href}>
                {dot}
              </a>
            ) : (
              <g key={`${p.label}-${i}`}>{dot}</g>
            );
          })}

        {firstLabel && (
          <text x={PAD.left} y={H - 6} fontSize={10} fontFamily="var(--font-mono)" fill="var(--fg-dim)">
            {firstLabel}
          </text>
        )}
        {lastLabel && (
          <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize={10} fontFamily="var(--font-mono)" fill="var(--fg-dim)">
            {lastLabel}
          </text>
        )}
      </svg>

      {/* The chart's twin. Sighted readers get the picture; everyone gets the numbers. */}
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {points.map((p, i) => (
            <tr key={`${p.label}-${i}`}>
              <th scope="row">{p.label}</th>
              <td>{formatValue(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {footer && <figcaption className="mt-1.5 text-tiny text-fg-dim">{footer}</figcaption>}
    </figure>
  );
}
