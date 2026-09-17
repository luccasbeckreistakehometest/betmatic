"use client";

import { useRef } from "react";

/**
 * Game-by-game bars with the betting line drawn across them. The line can be dragged (pointer or
 * keyboard); bars above it are green, below it muted, exactly on it (a push) grey. Inline SVG, no
 * chart library, same palette as the equity curve.
 */
export interface ChartBar { value: number; label: string; title: string }

const W = 640;
const H = 200;
const PAD = { top: 12, right: 8, bottom: 22, left: 30 };

export function PlayerChart({ bars, line, min, max, onLine, side, ariaLabel }: {
  bars: ChartBar[]; line: number; min: number; max: number; onLine: (n: number) => void; side: "over" | "under"; ariaLabel: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const top = Math.max(max, ...bars.map((b) => b.value), 1);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + innerH - (Math.max(0, v) / top) * innerH;
  const step = bars.length ? innerW / bars.length : innerW;
  const barW = Math.max(4, Math.min(26, step * 0.7));

  function lineAt(clientY: number) {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const rel = ((clientY - box.top) / box.height) * H;
    const v = ((PAD.top + innerH - rel) / innerH) * top;
    const snapped = Math.round(v * 2) / 2;
    onLine(Math.min(max, Math.max(min, snapped)));
  }

  const ticks = [0, top / 2, top].map((v) => Math.round(v));
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full touch-none select-none"
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={line}
      tabIndex={0}
      data-testid="player-chart"
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); onLine(Math.min(max, line + 0.5)); }
        if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); onLine(Math.max(min, line - 0.5)); }
      }}
      onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); lineAt(e.clientY); }}
      onPointerMove={(e) => { if (dragging.current) lineAt(e.clientY); }}
      onPointerUp={(e) => { dragging.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }}
    >
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--color-ink-700)" strokeWidth={1} />
          <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--color-mist-500)">{v}</text>
        </g>
      ))}
      {bars.map((b, i) => {
        const hit = side === "over" ? b.value > line : b.value < line;
        const push = b.value === line;
        const x = PAD.left + i * step + (step - barW) / 2;
        return (
          <g key={i}>
            <title>{b.title}</title>
            <rect x={x} y={y(b.value)} width={barW} height={Math.max(1, y(0) - y(b.value))} rx={2}
              fill={push ? "var(--color-mist-500)" : hit ? "var(--color-edge-400)" : "var(--color-ink-600)"} opacity={push ? 0.6 : 0.9} />
            {bars.length <= 20 && (
              <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={9} fill="var(--color-mist-500)">{b.label}</text>
            )}
          </g>
        );
      })}
      <line x1={PAD.left} x2={W - PAD.right} y1={y(line)} y2={y(line)} stroke="var(--color-warn-400)" strokeWidth={2} strokeDasharray="6 4" />
      <rect x={W - PAD.right - 44} y={y(line) - 9} width={44} height={16} rx={4} fill="var(--color-warn-400)" />
      <text x={W - PAD.right - 22} y={y(line) + 3} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--color-ink-950)">{line}</text>
    </svg>
  );
}
