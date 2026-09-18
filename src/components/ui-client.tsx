"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, cx, IconButton } from "@/components/ui";

/**
 * The interactive half of the primitive layer: everything that needs a hook, a focus trap or a
 * keyboard handler. Imported through "@/components/ui", never directly, so a screen has one import.
 * Spec: docs/DESIGN.md §12.8 (dialog), §12.2 (range), §7 (density).
 */

/* ── Dialog ────────────────────────────────────────────────────────────────────────────────────
 * The native element, because it already traps focus, closes on Esc and returns focus to the
 * trigger — three things a hand-rolled modal gets wrong. We supply the scrim, the radius and the
 * one shadow in the system that says "this floats and can be dismissed".
 */
/**
 * Open/close a native <dialog> from a boolean, and report every close — the Esc key and the
 * backdrop included — back to the owner of that boolean.
 */
function useDialogElement(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const close = () => onClose();
    const cancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    el.addEventListener("close", close);
    el.addEventListener("cancel", cancel);
    return () => {
      el.removeEventListener("close", close);
      el.removeEventListener("cancel", cancel);
    };
  }, [onClose]);

  return ref;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  closeLabel = "Fechar",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
}) {
  const ref = useDialogElement(open, onClose);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="m-auto w-full max-w-dialog rounded-panel border border-line bg-surface-1 p-0 text-fg shadow-dialog backdrop:bg-scrim"
    >
      <header className="flex min-h-(--row-h) items-center gap-2 border-b border-line px-(--cell-px) py-1.5">
        <h2 className="text-label u-label text-fg">{title}</h2>
        <span className="ml-auto">
          <IconButton icon="close" label={closeLabel} onClick={onClose} />
        </span>
      </header>
      <div className="p-(--panel-p) text-sm text-fg-muted">{children}</div>
      {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-(--cell-px) py-2">{footer}</footer>}
    </dialog>
  );
}

/* ── Sheet ─────────────────────────────────────────────────────────────────────────────────────
 * The phone's dialog: anchored to the bottom edge, rounded only on the top corners, with a drag
 * handle that says which way it leaves. Same native element, so the focus trap, Esc and the return
 * of focus to the trigger come for free.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  closeLabel = "Fechar",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
}) {
  const ref = useDialogElement(open, onClose);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="mt-auto mr-0 mb-0 ml-0 max-h-(--sheet-h) w-full max-w-full rounded-t-sheet border-t border-line bg-surface-1 p-0 text-fg shadow-dialog backdrop:bg-scrim"
    >
      <div className="flex justify-center pt-2 pb-1">
        <span aria-hidden="true" className="h-1 w-9 rounded-full bg-line-strong" />
      </div>
      <header className="flex min-h-(--row-h) items-center gap-2 border-b border-line px-(--cell-px) py-1.5">
        <h2 className="text-label u-label text-fg">{title}</h2>
        <span className="ml-auto">
          <IconButton icon="close" label={closeLabel} onClick={onClose} />
        </span>
      </header>
      <div className="overflow-y-auto p-(--panel-p) text-sm text-fg-muted">{children}</div>
      {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-(--cell-px) py-2">{footer}</footer>}
    </dialog>
  );
}

/* ── Tabs ──────────────────────────────────────────────────────────────────────────────────────
 * Roving tabindex, arrow keys, Home/End — a tab strip that a keyboard can drive. The active tab is
 * marked by a 2px rule and full-contrast text, never by colour alone.
 */
export function Tabs({
  tabs,
  initial = 0,
  className = "",
}: {
  tabs: { id: string; label: string; panel: ReactNode }[];
  initial?: number;
  className?: string;
}) {
  const [active, setActive] = useState(initial);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (next: number) => {
    const index = (next + tabs.length) % tabs.length;
    setActive(index);
    refs.current[index]?.focus();
  };

  return (
    <div className={className}>
      <div role="tablist" className="flex items-end gap-1 border-b border-line">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[i] = node;
            }}
            type="button"
            role="tab"
            id={`${base}-${tab.id}-tab`}
            aria-selected={i === active}
            aria-controls={`${base}-${tab.id}-panel`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") move(active + 1);
              else if (event.key === "ArrowLeft") move(active - 1);
              else if (event.key === "Home") move(0);
              else if (event.key === "End") move(tabs.length - 1);
              else return;
              event.preventDefault();
            }}
            className={cx(
              "h-(--row-h) rounded-t-control px-3 text-sm transition-colors duration-(--dur-1) ease-(--ease-out)",
              i === active ? "text-fg u-rule-active" : "text-fg-dim hover:bg-surface-2 hover:text-fg",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-${tab.id}-panel`}
          aria-labelledby={`${base}-${tab.id}-tab`}
          hidden={i !== active}
          className="pt-(--stack-gap)"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}

/* ── Range ─────────────────────────────────────────────────────────────────────────────────────
 * Both vendor pseudo-elements are styled in globals.css (.range), never accent-color — which is
 * what shipped one green and one macOS-blue slider in the same form on /app/parlays/custom.
 * The value is printed in mono next to the label, because a slider without a readout is a guess.
 */
export function RangeField({
  label,
  value,
  onValueChange,
  min,
  max,
  step = 1,
  format,
  disabled,
  className = "",
}: {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline gap-3 text-sm text-fg-muted">
        {label}
        <span className="ml-auto nums text-sm text-fg">{format ? format(value) : value}</span>
      </label>
      <input
        id={id}
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(Number(event.target.value))}
      />
    </div>
  );
}

/* ── Theme and density ─────────────────────────────────────────────────────────────────────────
 * Both are attributes on <html>, written before paint by the inline script in layout.tsx. The
 * control reads the DOM through useSyncExternalStore rather than mirroring it in state, so there is
 * no effect that writes state on mount and no flash of the wrong value on hydration.
 */
type Theme = "system" | "light" | "dark";
type Density = "compact" | "default" | "comfortable";

function subscribeToRoot(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-density"] });
  return () => observer.disconnect();
}

function useRootAttribute(name: "theme" | "density", fallback: string) {
  const read = useCallback(() => document.documentElement.dataset[name] ?? "system", [name]);
  return useSyncExternalStore(subscribeToRoot, read, () => fallback);
}

function writeRootAttribute(name: "theme" | "density", value: string, storageKey: string) {
  const root = document.documentElement;
  if (value === "system") delete root.dataset[name];
  else root.dataset[name] = value;
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    // A blocked storage is not a reason to refuse the change for this page view.
  }
}

/** A segmented control: three options, one rule under the chosen one, no hue. */
function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-label u-label text-fg-dim">{label}</span>
      <div className="flex rounded-control border border-line-control">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
            className={cx(
              "h-(--row-h) px-2.5 text-sm transition-colors duration-(--dur-1) ease-(--ease-out) first:rounded-l-control last:rounded-r-control",
              value === option.id ? "bg-action text-action-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ThemeSwitch({ labels }: { labels?: { theme: string; system: string; light: string; dark: string } }) {
  const copy = labels ?? { theme: "Tema", system: "Sistema", light: "Claro", dark: "Escuro" };
  const theme = useRootAttribute("theme", "dark") as Theme;
  return (
    <Segmented
      label={copy.theme}
      value={theme}
      onChange={(id) => writeRootAttribute("theme", id, "bm-theme")}
      options={[
        { id: "system", label: copy.system },
        { id: "light", label: copy.light },
        { id: "dark", label: copy.dark },
      ]}
    />
  );
}

export function DensitySwitch({ labels }: { labels?: { density: string; compact: string; default: string; comfortable: string } }) {
  const copy = labels ?? { density: "Densidade", compact: "Compacta", default: "Padrão", comfortable: "Ampla" };
  const density = useRootAttribute("density", "default") as Density;
  return (
    <Segmented
      label={copy.density}
      value={density}
      onChange={(id) => writeRootAttribute("density", id, "bm-density")}
      options={[
        { id: "compact", label: copy.compact },
        { id: "default", label: copy.default },
        { id: "comfortable", label: copy.comfortable },
      ]}
    />
  );
}

/* ── Print ─────────────────────────────────────────────────────────────────────────────────────
 * The two screens that produce a document — the weekly report and the public record — offer the
 * sheet directly. The print rules in globals.css strip the chrome and leave one column.
 */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button icon="printer" className="print-hide" onClick={() => window.print()}>
      {label}
    </Button>
  );
}

/**
 * A printed sheet says who made it and when — otherwise a page that leaves the screen is an
 * anonymous fragment. Invisible on screen; the print rules reveal it. The timestamp differs
 * between the server render and the reader's clock by design, so the mismatch is suppressed.
 */
export function PrintHeader({ subject, lang }: { subject: string; lang: "pt" | "en" }) {
  return (
    <header data-print="only" className="mb-4 flex items-baseline justify-between gap-4 border-b border-line pb-2">
      <span className="u-display text-lead text-fg">Betmatic</span>
      <span className="text-tiny text-fg-muted">{subject}</span>
      <span className="nums text-tiny text-fg-dim" suppressHydrationWarning>
        {new Intl.DateTimeFormat(lang === "pt" ? "pt-BR" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date())}
      </span>
    </header>
  );
}
