/**
 * The image loader for next/image (next.config.ts → images.loaderFile).
 *
 * The five landing plates are encoded ahead of time by scripts/build-plates.mjs, one WebP per
 * width, so the server never optimises an image at request time: `sharp` is not in the runtime
 * image, /_next/image is never hit, and Caddy can cache every file. next/image still does the work
 * that matters — it builds the srcset from `sizes`, reserves the box and lazy-loads everything but
 * the hero; this function only says which file a given width means.
 *
 * WIDTHS must stay in step with scripts/build-plates.mjs.
 */
const WIDTHS = [384, 640, 960, 1280];

export default function plateLoader({ src, width }: { src: string; width: number; quality?: number }): string {
  // Anything that is not a pre-encoded plate (a remote logo, say) is handed back untouched.
  if (!src.endsWith(".webp")) return src;
  const encoded = WIDTHS.find((candidate) => candidate >= width) ?? WIDTHS[WIDTHS.length - 1];
  return src.replace(/\.webp$/, `-${encoded}.webp`);
}
