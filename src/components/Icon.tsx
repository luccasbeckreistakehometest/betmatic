/**
 * The product's only icon source: one hand-drawn sprite (public/icons.svg), referenced by <use>,
 * so adding a glyph costs a path and never a package. Every glyph is a 20×20 drawing at stroke 1.5
 * in currentColor; a 16px icon is this drawing scaled, not a 24px icon shrunk (docs/DESIGN.md §10).
 *
 * Icons sit on the text baseline by optical offset, not by flexbox guesswork, so a label and its
 * icon share one baseline inside a button or a table cell.
 *
 * Decorative by default (aria-hidden). Pass `title` only when the icon is the sole label — and then
 * prefer an aria-label on the button instead.
 */
export const ICON_NAMES = [
  "calendar",
  "chevron-down",
  "chevron-up",
  "chevron-left",
  "chevron-right",
  "search",
  "filter",
  "sort",
  "check",
  "close",
  "plus",
  "minus",
  "arrow-up-right",
  "arrow-down-right",
  "external",
  "copy",
  "download",
  "refresh",
  "info",
  "alert",
  "lock",
  "user",
  "menu",
  "printer",
  "grid",
  "layers",
  "receipt",
  "wallet",
  "list-check",
  "bell",
  "target",
  "bars",
  "trophy",
  "gift",
  "sliders",
  "tag",
  "shield",
  "pulse",
  "logout",
  "trash",
  "edit",
  "link",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export function Icon({
  name,
  size = 16,
  className = "",
  title,
}: {
  name: IconName;
  /** 16 in dense UI, 20 when the icon stands alone. Nothing else. */
  size?: 16 | 20;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      className={`inline-block shrink-0 align-[-0.15em] ${className}`}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <use href={`/icons.svg#${name}`} />
    </svg>
  );
}
