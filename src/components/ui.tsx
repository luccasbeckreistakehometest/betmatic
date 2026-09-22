import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { NOT_PRICED, formatOdds, formatPercent, impliedFromDecimal } from "@/lib/format";
import { t as translate, type DictKey, type Lang } from "@/lib/i18n";
import type { SourceStatus } from "@/lib/types";

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * Mesa de Operações — the primitive layer. Everything a screen renders comes from here.
 * Spec: docs/DESIGN.md. Gallery of every primitive in every state: /design.
 *
 * HOW TO USE IT
 *
 *   · Tokens only. No raw hex, no raw px, no arbitrary Tailwind value. `bg-surface-1`,
 *     `text-fg-muted`, `border-line`, `rounded-panel`, `h-(--row-h)` — never `bg-[#10131a]` — design-guard-allow
 *     or `text-[13.5px]`.
 *   · Colour means state, never decoration: `pos` is a settled win or a positive delta, `neg` a
 *     settled loss, `warn` a caution, `focus` the keyboard's position and the current selection.
 *     The primary action is achromatic on purpose, so it never competes with data.
 *   · Every number a reader compares to another number goes through src/lib/format.ts and is set
 *     with the `nums` utility (Plex Mono, tabular, slashed zero). Never toFixed in a component.
 *   · Density comes from the shell: put data-density="compact" on a dense region and the row
 *     height, cell padding and panel padding follow. Never hard-code a height.
 *   · Focus rings are global (globals.css §12.0). Never add one, never write outline-none.
 *   · Interactive primitives that need hooks live in ui-client.tsx and are re-exported at the
 *     bottom of this file, so a screen imports everything from "@/components/ui".
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Button ────────────────────────────────────────────────────────────────────────────────────
 * One primary per view. A button never changes width between states: the loading spinner replaces
 * the icon slot and the label stays, so a row of buttons cannot reflow while one is busy.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap " +
  "transition-[background-color,border-color,color] duration-(--dur-1) ease-(--ease-out) active:translate-y-px " +
  "disabled:cursor-not-allowed disabled:active:translate-y-0 aria-busy:cursor-progress";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-action text-action-fg hover:bg-action-hover active:bg-action-active " +
    "disabled:bg-surface-3 disabled:text-fg-faint",
  secondary:
    "border border-line-control text-fg hover:bg-surface-2 active:bg-surface-3 " +
    "disabled:border-line disabled:text-fg-faint disabled:hover:bg-transparent",
  ghost:
    "text-fg-muted hover:bg-surface-2 hover:text-fg active:bg-surface-3 " +
    "disabled:text-fg-faint disabled:hover:bg-transparent",
  danger:
    "border border-neg text-neg hover:bg-neg-tint active:bg-neg-tint " +
    "disabled:border-line disabled:text-fg-faint disabled:hover:bg-transparent",
};

/** A 14px ring that spins in place of the icon, so the button keeps its width while it works. */
function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70",
        className,
      )}
    />
  );
}

/**
 * The button's geometry and variants for the two cases that cannot be a `<Button>`: a `next/link`
 * (which must stay a `Link` for client navigation) and a `<label>` wrapping a file input. One
 * source, so a change to the control's height or focus ring reaches every one of them.
 */
export function buttonClass(variant: ButtonVariant = "secondary", className = ""): string {
  return cx(BUTTON_BASE, BUTTON_VARIANT[variant], className);
}

export function Button({
  variant = "secondary",
  icon,
  iconEnd,
  loading = false,
  className = "",
  children,
  disabled,
  ...rest
}: ComponentProps<"button"> & { variant?: ButtonVariant; icon?: IconName; iconEnd?: IconName; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], className)}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} /> : null}
      {children}
      {iconEnd && !loading ? <Icon name={iconEnd} /> : null}
    </button>
  );
}

/** The same button as a link. An external destination says so with a glyph, never with a colour. */
export function LinkButton({
  variant = "secondary",
  icon,
  iconEnd,
  className = "",
  children,
  ...rest
}: ComponentProps<"a"> & { variant?: ButtonVariant; icon?: IconName; iconEnd?: IconName }) {
  return (
    <a {...rest} className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], className)}>
      {icon && <Icon name={icon} />}
      {children}
      {iconEnd && <Icon name={iconEnd} />}
    </a>
  );
}

/** Square at the row height, always labelled: an icon alone is never a label. */
export function IconButton({
  icon,
  label,
  variant = "ghost",
  className = "",
  ...rest
}: Omit<ComponentProps<"button">, "children"> & { icon: IconName; label: string; variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      {...rest}
      aria-label={label}
      title={label}
      className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], "w-(--row-h) px-0", className)}
    >
      <Icon name={icon} />
    </button>
  );
}

/* ── Fields ────────────────────────────────────────────────────────────────────────────────────
 * Label above the field, help text below it, the error message owned by the field through
 * aria-describedby. A placeholder never replaces a label, and "required" is a word, not an asterisk.
 */

const CONTROL_BASE =
  "w-full h-(--row-h) rounded-control border bg-surface-3 px-2.5 text-sm text-fg " +
  "transition-[border-color] duration-(--dur-1) ease-(--ease-out) " +
  "hover:border-fg-dim focus:border-focus " +
  "disabled:cursor-not-allowed disabled:bg-surface-1 disabled:text-fg-faint";

/* A read-only value is text, not a field: no fill, no edge, mono. Only inputs and textareas take
   this — :read-only also matches <select>, which is what blanked every select's border once. */
const CONTROL_READONLY =
  "read-only:border-transparent read-only:bg-transparent read-only:px-0 read-only:nums " +
  "read-only:hover:border-transparent read-only:focus:border-transparent";

export function Field({
  label,
  htmlFor,
  help,
  error,
  required,
  requiredLabel = "obrigatório",
  className = "",
  children,
}: {
  label: string;
  htmlFor: string;
  help?: string;
  error?: string;
  required?: boolean;
  requiredLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="flex items-baseline gap-1.5 text-sm text-fg-muted">
        {label}
        {required && <span className="text-tiny text-fg-dim">{requiredLabel}</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="flex items-start gap-1.5 text-tiny text-neg">
          <Icon name="alert" className="mt-px" />
          {error}
        </p>
      ) : help ? (
        <p id={`${htmlFor}-help`} className="text-tiny text-fg-dim">
          {help}
        </p>
      ) : null}
    </div>
  );
}

export function Input({
  invalid,
  numeric,
  suffix,
  className = "",
  ...rest
}: ComponentProps<"input"> & { invalid?: boolean; numeric?: boolean; suffix?: string }) {
  const field = (
    <input
      {...rest}
      inputMode={numeric ? "decimal" : rest.inputMode}
      aria-invalid={invalid || undefined}
      aria-describedby={rest.id ? `${rest.id}-${invalid ? "error" : "help"}` : rest["aria-describedby"]}
      className={cx(
        CONTROL_BASE,
        CONTROL_READONLY,
        invalid ? "border-neg" : "border-line-control",
        numeric && "nums text-right",
        suffix && "pr-8",
        className,
      )}
    />
  );
  if (!suffix) return field;
  // The unit lives inside the field, never as a floating label that can drift from its number.
  return (
    <span className="relative block">
      {field}
      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-tiny text-fg-dim">{suffix}</span>
    </span>
  );
}

export function Textarea({ invalid, className = "", ...rest }: ComponentProps<"textarea"> & { invalid?: boolean }) {
  return (
    <textarea
      {...rest}
      aria-invalid={invalid || undefined}
      className={cx(CONTROL_BASE, CONTROL_READONLY, "h-auto min-h-20 py-2 leading-relaxed", invalid ? "border-neg" : "border-line-control", className)}
    />
  );
}

/** The platform's chevron is replaced by ours, at our optical size, in our colour. */
export function Select({
  invalid,
  className = "",
  wrapperClassName = "",
  children,
  ...rest
}: ComponentProps<"select"> & { invalid?: boolean; wrapperClassName?: string }) {
  return (
    <span className={cx("relative inline-block", wrapperClassName)}>
      <select
        {...rest}
        aria-invalid={invalid || undefined}
        className={cx(CONTROL_BASE, "appearance-none pr-8", invalid ? "border-neg" : "border-line-control", className)}
      >
        {children}
      </select>
      <Icon name="chevron-down" className="pointer-events-none absolute inset-y-0 right-2 my-auto text-fg-dim" />
    </span>
  );
}

export function Checkbox({ label, className = "", ...rest }: Omit<ComponentProps<"input">, "type"> & { label: ReactNode }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-2 text-sm text-fg has-[:disabled]:cursor-not-allowed has-[:disabled]:text-fg-faint", className)}>
      <span className="relative inline-flex size-4 shrink-0">
        <input
          {...rest}
          type="checkbox"
          className="peer size-4 appearance-none rounded-control border border-line-control bg-surface-3 checked:border-action checked:bg-action disabled:border-line disabled:bg-surface-1"
        />
        <Icon name="check" className="pointer-events-none absolute inset-0 text-action-fg opacity-0 peer-checked:opacity-100" />
      </span>
      {label}
    </label>
  );
}

export function Radio({ label, className = "", ...rest }: Omit<ComponentProps<"input">, "type"> & { label: ReactNode }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-2 text-sm text-fg has-[:disabled]:cursor-not-allowed has-[:disabled]:text-fg-faint", className)}>
      <span className="relative inline-flex size-4 shrink-0">
        <input
          {...rest}
          type="radio"
          className="peer size-4 appearance-none rounded-full border border-line-control bg-surface-3 checked:border-action disabled:border-line disabled:bg-surface-1"
        />
        <span className="pointer-events-none absolute inset-0 m-1 rounded-full bg-action opacity-0 peer-checked:opacity-100" />
      </span>
      {label}
    </label>
  );
}

/* ── Badges, chips, status ─────────────────────────────────────────────────────────────────────
 * Every tone carries a word. Colour alone never says whether something won or lost.
 */

export type Tone = "neutral" | "pos" | "neg" | "warn" | "info";

const TONE_STYLE: Record<Tone, string> = {
  neutral: "border-line text-fg-muted bg-surface-2",
  pos: "border-pos/40 text-pos bg-pos-tint",
  neg: "border-neg/40 text-neg bg-neg-tint",
  warn: "border-warn/40 text-warn bg-warn-tint",
  info: "border-focus/40 text-focus bg-focus/10",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex h-5 items-center rounded-control border px-1.5 text-label u-label", TONE_STYLE[tone], className)}>
      {children}
    </span>
  );
}

/**
 * A chip you press — a market, a league, an odds band — is a toggle (§12.6): pressed is the
 * achromatic action fill, exactly like the primary button; unpressed is a control edge. On a
 * phone the chip grows to a fingertip and takes the body size; a desk keeps the dense geometry.
 * Pair it with aria-pressed on the button.
 */
export function chipClass(on: boolean, className = ""): string {
  return cx(
    "inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1 text-tiny whitespace-nowrap transition-colors duration-(--dur-1) ease-(--ease-out) max-md:u-hit max-md:min-h-9 max-md:px-3 max-md:text-sm",
    on ? "border-action bg-action text-action-fg" : "border-line-control text-fg-muted hover:bg-surface-2 hover:text-fg",
    className,
  );
}

const LEGACY_TONE: Record<string, Tone> = { high: "pos", medium: "warn", low: "neutral", pos: "pos", neg: "neg", warn: "warn", info: "info", neutral: "neutral" };

/** Kept for the screens waves 1–4 have not reached yet: `high`/`medium`/`low` map onto the tones. */
export function Chip({ tone, selected, children, className = "" }: { tone?: string; selected?: boolean; children: ReactNode; className?: string }) {
  // A selected chip is achromatic, exactly like the primary button — selection is not a hue.
  if (selected) {
    return (
      <span className={cx("inline-flex h-5 shrink-0 items-center rounded-control border border-action bg-action px-1.5 text-label u-label text-action-fg", className)}>
        {children}
      </span>
    );
  }
  return (
    <Badge tone={LEGACY_TONE[tone ?? "neutral"] ?? "neutral"} className={cx("shrink-0", className)}>
      {children}
    </Badge>
  );
}

const STATUS_TONE: Record<SourceStatus | "pending" | "idle", { key: DictKey; tone: Tone }> = {
  ok: { key: "statusOk", tone: "pos" },
  empty: { key: "statusEmpty", tone: "neutral" },
  "needs-login": { key: "loginNeeded", tone: "warn" },
  disabled: { key: "statusOff", tone: "neutral" },
  error: { key: "statusError", tone: "neg" },
  pending: { key: "statusPending", tone: "info" },
  idle: { key: "statusIdle", tone: "neutral" },
};

export function StatusBadge({ status, lang = "pt" }: { status: SourceStatus | "pending" | "idle"; lang?: Lang }) {
  const style = STATUS_TONE[status] ?? STATUS_TONE.idle;
  return <Badge tone={style.tone}>{translate(style.key, lang)}</Badge>;
}

/* ── Panel ─────────────────────────────────────────────────────────────────────────────────────
 * A header row at the row height with a rule under it, then the body at the density's padding.
 * Panels never nest more than one level: a panel inside a panel becomes a ruled group.
 */

export function Panel({
  title,
  status,
  meta,
  action,
  lang = "pt",
  flush = false,
  className = "",
  children,
  ...rest
}: {
  title?: string;
  status?: SourceStatus | "pending" | "idle";
  meta?: ReactNode;
  action?: ReactNode;
  lang?: Lang;
  /** Tables sit edge to edge: no body padding, the rules reach the panel's border. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<"section">, "title" | "action">) {
  return (
    <section {...rest} className={cx("rounded-panel border border-line bg-surface-1", className)}>
      {(title || action || meta || status) && (
        <header className="flex min-h-(--row-h) flex-wrap items-center gap-2 border-b border-line px-(--cell-px) py-1.5">
          {title && <h2 className="text-label u-label text-fg">{title}</h2>}
          {status && <StatusBadge status={status} lang={lang} />}
          {meta && <span className="text-tiny text-fg-dim">{meta}</span>}
          {action && <div className="ml-auto flex items-center gap-1.5">{action}</div>}
        </header>
      )}
      <div className={flush ? "" : "p-(--panel-p)"}>{children}</div>
    </section>
  );
}

/* ── Page head ─────────────────────────────────────────────────────────────────────────────────
 * Every screen in the app opens the same way: a title in the display face, the facts about what is
 * on screen beside it, and the controls that change it on the right — all on one ruled line, so a
 * reader moving between screens never has to find the heading again.
 */

export function PageHead({
  title,
  kicker,
  meta,
  actions,
  className = "",
}: {
  title: ReactNode;
  /** The section this screen belongs to, in the rail's own words. */
  kicker?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line-strong pb-3", className)}>
      <div className="min-w-0">
        {kicker && <p className="mb-1 text-label u-label text-fg-dim">{kicker}</p>}
        <h1 className="u-title text-h3 text-fg">{title}</h1>
        {meta && <p className="mt-1 max-w-measure-app text-tiny text-fg-dim">{meta}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 pt-0.5">{actions}</div>}
    </header>
  );
}

/** A caution that is a standing condition, not a failure: amber rule, never a red box (§13). */
export function Notice({ tone = "warn", children }: { tone?: "warn" | "info" | "neg"; children: ReactNode }) {
  const style = tone === "neg" ? "border-neg bg-neg-tint text-neg" : tone === "info" ? "border-focus bg-focus/10 text-fg" : "border-warn bg-warn-tint text-warn";
  return (
    <p role={tone === "neg" ? "alert" : undefined} className={cx("border-l-2 px-3 py-2 text-sm", style)}>
      {children}
    </p>
  );
}

/* ── Empty, loading, error ─────────────────────────────────────────────────────────────────────
 * Three states every data region ships. The region's own frame stays drawn so the reader can see
 * what will arrive; "filtered to nothing" is its own state, because it is not empty.
 */

/**
 * Nothing here yet — drawn as the shape of what is missing, not as a sentence floating in a wide
 * column: the sentence, one action, and the region's own rules at the row height the rows will
 * have. `rows={0}` for a region that is not a list (a chart, a form, a paragraph of prose).
 */
export function Empty({ action, rows = 3, children }: { action?: ReactNode; rows?: number; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-2">
      <p className="max-w-measure-app text-sm leading-relaxed text-fg-muted">{children}</p>
      {action}
      {rows > 0 && (
        <div aria-hidden="true" className="mt-1 w-full border-t border-line">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="h-(--row-h) border-b border-line" />
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorState({ title, detail, code, action }: { title: string; detail?: string; code?: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 border-l-2 border-neg py-1 pl-3">
      <p className="text-sm font-medium text-fg">{title}</p>
      {detail && <p className="max-w-measure-app text-sm text-fg-muted">{detail}</p>}
      {action}
      {code && <code className="select-all text-micro text-fg-dim nums">{code}</code>}
    </div>
  );
}

/** A grey bar at the size of the content it stands in for — never a spinner over a whole region. */
export function Skeleton({ className = "", width }: { className?: string; width?: string }) {
  return <span aria-hidden="true" className={cx("block h-3 rounded-control bg-surface-2", className)} style={width ? { width } : undefined} />;
}

/* ── Table ─────────────────────────────────────────────────────────────────────────────────────
 * Rules, not zebra: one inset rule per row, two under the header. Text left, numbers right, the
 * header takes its column's alignment. The table is the only element allowed to scroll sideways.
 */

export function Table({
  caption,
  collapse = true,
  children,
  className = "",
}: {
  caption: string;
  /** Below 768px the rows become definition lists. Turn it off only for a two-column table. */
  collapse?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="max-w-full min-w-0 overflow-x-auto">
      <table data-collapse={collapse ? "true" : undefined} className={cx("w-full border-collapse text-left", className)}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({
  numeric = false,
  sticky = false,
  className = "",
  children,
  ...rest
}: ComponentProps<"th"> & { numeric?: boolean; sticky?: boolean }) {
  return (
    <th
      scope="col"
      {...rest}
      className={cx(
        // A column header never wraps: a two-line header drops its baseline away from its column
        // and the header row stops scanning as one line.
        "h-(--row-h) bg-surface-1 px-(--cell-px) text-label u-label whitespace-nowrap text-fg-dim u-rule-2",
        numeric ? "text-right" : "text-left",
        sticky && "sticky top-0 z-10",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Tr({
  tone,
  selected,
  className = "",
  children,
  ...rest
}: ComponentProps<"tr"> & { tone?: "pos" | "neg" | "warn"; selected?: boolean }) {
  return (
    <tr
      {...rest}
      data-tone={tone}
      data-selected={selected ? "true" : undefined}
      className={cx("u-rule transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-surface-2", className)}
    >
      {children}
    </tr>
  );
}

export function Td({ label, numeric = false, className = "", children, ...rest }: ComponentProps<"td"> & { numeric?: boolean; label?: string }) {
  return (
    <td {...rest} data-label={label} className={cx("h-(--row-h) px-(--cell-px) align-middle text-sm", numeric ? "nums text-right tabular-nums" : "text-fg", className)}>
      {children}
    </td>
  );
}

/** A number in a column: mono, tabular, right-aligned, and coloured only when it is a result. */
export function NumCell({
  tone,
  chance,
  label,
  className = "",
  children,
  ...rest
}: ComponentProps<"td"> & { tone?: "pos" | "neg"; chance?: 1 | 2 | 3 | 4 | 5; label?: string }) {
  return (
    <td
      {...rest}
      data-chance={chance}
      data-label={label}
      className={cx(
        "h-(--row-h) px-(--cell-px) text-right align-middle text-sm nums",
        tone === "pos" && "text-pos",
        tone === "neg" && "text-neg",
        !tone && "text-fg",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Which step of the chance ramp a probability falls on (§6.5). Never applied to the text. */
export function chanceStep(probability: number): 1 | 2 | 3 | 4 | 5 {
  if (!Number.isFinite(probability)) return 5;
  if (probability >= 0.5) return 1;
  if (probability >= 0.2) return 2;
  if (probability >= 0.05) return 3;
  if (probability >= 0.01) return 4;
  return 5;
}

/** The skeleton is the table, not three grey pills: same columns, same widths, rows at --row-h. */
export function TableSkeleton({ columns, rows = 5 }: { columns: { width: string; numeric?: boolean }[]; rows?: number }) {
  return (
    <tbody aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="u-rule">
          {columns.map((col, c) => (
            <td key={c} className="h-(--row-h) px-(--cell-px)">
              <Skeleton width={col.width} className={col.numeric ? "ml-auto" : undefined} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

/* ── Numbers on screen ─────────────────────────────────────────────────────────────────────────*/

/**
 * A price and the chance it carries, always together. This is the product's argument and, in
 * Brazil, the advertising rule: a multiplier alone is never shown, so the primitive derives the
 * implied chance when a measured one is not supplied rather than rendering half the pair.
 */
export function Odds({
  decimal,
  probability,
  lang = "pt",
  className = "",
}: {
  decimal: number;
  /** The measured chance when the model has one; otherwise the price's own implied chance. */
  probability?: number;
  lang?: Lang;
  className?: string;
}) {
  const priced = Number.isFinite(decimal) && decimal > 1;
  const chance = Number.isFinite(probability) ? (probability as number) : impliedFromDecimal(decimal);
  if (!priced) return <span className={cx("nums text-fg-dim", className)}>{NOT_PRICED}</span>;
  return (
    <span className={cx("inline-flex items-baseline gap-1 whitespace-nowrap", className)}>
      <span className="nums text-fg">{formatOdds(decimal, lang)}</span>
      {/* Without a separator "3,19 7,4 %" reads at a glance as one number with a decimal error. */}
      <span aria-hidden="true" className="text-tiny text-fg-dim">·</span>
      <span className="nums text-tiny text-fg-dim">{formatPercent(chance, lang)}</span>
    </span>
  );
}

/**
 * A KPI reads as a line, not as a box: the label sits on the 4px grid and the value hangs 8px under
 * its baseline, so a row of them scans horizontally.
 */
export function KPI({
  label,
  value,
  sub,
  tone,
  className = "",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "pos" | "neg";
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <span className="text-label u-label text-fg-dim">{label}</span>
      <span className={cx("nums text-h3 leading-none", tone === "pos" && "text-pos", tone === "neg" && "text-neg", !tone && "text-fg")}>{value}</span>
      {sub && <span className="text-tiny text-fg-dim">{sub}</span>}
    </div>
  );
}

/** Label left, value right, one rule between rows — the mobile form of a dense table row. */
export function KeyValue({ rows, emptyText = NOT_PRICED }: { rows: { label: string; value: string; hint?: string }[]; emptyText?: string }) {
  if (!rows.length) return <Empty>{emptyText}</Empty>;
  return (
    <dl>
      {rows.map((row, i) => (
        <div key={`${row.label}-${i}`} className="flex items-baseline gap-3 py-1.5 u-rule last:shadow-none">
          <dt className="text-sm text-fg-muted">{row.label}</dt>
          <dd className="ml-auto text-right text-sm text-fg nums">
            {row.value}
            {row.hint && <span className="ml-1.5 text-tiny text-fg-dim">{row.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A delayed label for an icon-only control. CSS only, so it costs no JavaScript on a server page. */
export function Tooltip({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <span className={cx("group relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full right-0 z-30 mt-1 rounded-panel md:right-auto md:left-1/2 md:-translate-x-1/2 border border-line bg-surface-1 px-2 py-1 text-tiny whitespace-nowrap text-fg opacity-0 shadow-pop transition-opacity delay-(--dur-tip) duration-(--dur-2) group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

/* Interactive primitives (hooks, focus traps, keyboard handling) live next door so this module
   stays renderable from a server component. Screens import everything from "@/components/ui". */
export { DensitySwitch, Dialog, PrintButton, PrintHeader, RangeField, Sheet, Tabs, ThemeSwitch } from "@/components/ui-client";
