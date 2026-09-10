import type { ReactNode } from "react";
import type { SourceStatus } from "@/lib/types";

const STATUS_STYLE: Record<SourceStatus | "pending" | "idle", { label: string; className: string }> = {
  ok: { label: "ok", className: "bg-edge-400/12 text-edge-400 border-edge-400/25" },
  empty: { label: "no data", className: "bg-ink-800 text-mist-400 border-ink-700" },
  "needs-login": { label: "login needed", className: "bg-warn-400/12 text-warn-400 border-warn-400/25" },
  disabled: { label: "off", className: "bg-ink-800 text-mist-500 border-ink-700" },
  error: { label: "error", className: "bg-alert-400/12 text-alert-400 border-alert-400/25" },
  pending: { label: "gathering…", className: "bg-signal-400/12 text-signal-400 border-signal-400/25" },
  idle: { label: "idle", className: "bg-ink-800 text-mist-500 border-ink-700" },
};

export function StatusBadge({ status }: { status: SourceStatus | "pending" | "idle" }) {
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.idle;
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${style.className}`}>
      {style.label}
    </span>
  );
}

export function Panel({
  title,
  status,
  meta,
  action,
  children,
}: {
  title: string;
  status?: SourceStatus | "pending" | "idle";
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-ink-800 bg-ink-900/60">
      <header className="flex flex-wrap items-center gap-2 border-b border-ink-800 px-4 py-2.5">
        <h2 className="text-[13px] font-semibold tracking-tight text-mist-100">{title}</h2>
        {status && <StatusBadge status={status} />}
        {meta && <span className="text-[11px] text-mist-500">{meta}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-mist-500">{children}</p>;
}

export function KeyValue({ rows }: { rows: { label: string; value: string; hint?: string }[] }) {
  if (!rows.length) return <Empty>Nothing reported.</Empty>;
  return (
    <dl className="divide-y divide-ink-800">
      {rows.map((row, i) => (
        <div key={`${row.label}-${i}`} className="flex items-baseline gap-3 py-1.5 first:pt-0 last:pb-0">
          <dt className="text-[12px] text-mist-400">{row.label}</dt>
          <dd className="nums ml-auto text-right text-[12px] text-mist-100">
            {row.value}
            {row.hint && <span className="ml-1.5 text-[10px] text-mist-500">{row.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const CONFIDENCE_TONE: Record<string, string> = {
  high: "text-edge-400 border-edge-400/30 bg-edge-400/10",
  medium: "text-warn-400 border-warn-400/30 bg-warn-400/10",
  low: "text-mist-400 border-ink-700 bg-ink-800",
};

export function Chip({ tone, children }: { tone?: string; children: ReactNode }) {
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        CONFIDENCE_TONE[tone ?? ""] ?? "border-ink-700 bg-ink-800 text-mist-400"
      }`}
    >
      {children}
    </span>
  );
}
