import Image from "next/image";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * A plate: one of the five commissioned images, framed as a deliberately dark panel.
 *
 * All five images are lit for the dark mode, and the light palette is what globals.css declares on
 * bare :root — a reader who picks light in the settings gets it on every page. Dropped on a white
 * page a dark picture reads as a black rectangle that failed to load, so the frame keeps the dark
 * value in BOTH themes — `--plate` and `--plate-line` are defined once and never overridden — and
 * the picture reads as a panel someone meant to be dark. The radius and the hairline are the
 * system's own (§8.1, §8.3).
 *
 * The box reserves its ratio before a byte arrives, so nothing on the page ever jumps, and only the
 * hero passes `priority`: everything below it loads when the reader gets there.
 */
export function Plate({
  image,
  alt,
  sizes,
  ratio = "aspect-plate-wide",
  caption,
  priority = false,
  flush = false,
  className = "",
}: {
  /** Path of the plate without its width, e.g. /img/plate/hand-phone.webp (src/lib/plate-loader.ts). */
  image: string;
  /** What is in the picture, in the reader's language. Empty only for a plate that says nothing. */
  alt: string;
  /** The slot's real width at each breakpoint — wrong here means the phone downloads the desk's file. */
  sizes: string;
  ratio?: string;
  caption?: ReactNode;
  priority?: boolean;
  /** Inside a panel that already draws the edge: no border, no radius of its own. */
  flush?: boolean;
  className?: string;
}) {
  return (
    <figure className={className}>
      <div className={cx("relative overflow-hidden bg-plate", ratio, !flush && "rounded-panel border border-plate-line")}>
        <Image src={image} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />
      </div>
      {caption && <figcaption className="mt-2.5 max-w-measure text-tiny leading-relaxed text-fg-dim">{caption}</figcaption>}
    </figure>
  );
}
