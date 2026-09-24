#!/usr/bin/env node
/**
 * The five plates of the landing page, encoded once and committed.
 *
 * The approved masters are 1–2 MB PNGs (9 MB for the set) lit for the dark mode. A landing that
 * ships 9 MB of image converts worse than one with no image at all, so nothing here is optimised
 * per request: ffmpeg writes one WebP per width into public/img/plate/ and src/lib/plate-loader.ts
 * hands those files straight to next/image. No sharp in the runtime image, no /_next/image round
 * trip, no CPU spent per visitor, and every byte is cacheable by Caddy for a year.
 *
 * The masters live in assets/plates/ and stay out of git: a browser never asks for them, and the
 * repo should carry the ~330 KB it serves rather than 9 MB it does not. Keep them somewhere safe
 * and re-run this only when one of them changes:
 *
 *   node scripts/build-plates.mjs [source-dir]     # default: assets/plates
 *
 * WIDTHS must stay in step with src/lib/plate-loader.ts — the loader snaps a requested width up to
 * one of these, so a width listed there and missing here is a 404 in somebody's srcset.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Source file → the name the site refers to it by. English, and it says what the picture is. */
const PLATES = {
  "src-2.png": "hand-phone",
  "src-3.png": "ledger-line",
  "src-4.png": "phone-blueprint",
  "src-5.png": "slip-tape",
  "src-6.png": "founder",
};

/** 1280 covers the widest slot (a 576 px column at 2×, a 360 px phone at 3×); 384 covers the portrait. */
const WIDTHS = [384, 640, 960, 1280];

/** Measured on this set: 76 keeps the wireframe hairlines and the film grain, 68 loses both. */
const QUALITY = 76;

const sourceDir = process.argv[2] ?? "assets/plates";
const outDir = "public/img/plate";

if (!existsSync(sourceDir)) {
  console.error(`build-plates: no source directory at ${sourceDir}.\n  The masters are not in git — point this at the folder that holds them.`);
  process.exit(1);
}
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  console.error("build-plates: ffmpeg is not on PATH. It is the encoder; install it and run again.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
let written = 0;
let bytes = 0;
for (const [file, name] of Object.entries(PLATES)) {
  const source = join(sourceDir, file);
  if (!existsSync(source)) {
    console.error(`build-plates: missing ${source}`);
    process.exit(1);
  }
  for (const width of WIDTHS) {
    const out = join(outDir, `${name}-${width}.webp`);
    execFileSync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error", "-i", source,
      // -2 keeps the height even and the aspect ratio exact, so the reserved box never lies.
      "-vf", `scale=${width}:-2`,
      "-c:v", "libwebp", "-quality", String(QUALITY), "-compression_level", "6", "-preset", "picture",
      out,
    ]);
    written += 1;
    bytes += statSync(out).size;
  }
}

const stale = readdirSync(outDir).filter((f) => !Object.values(PLATES).some((n) => WIDTHS.some((w) => f === `${n}-${w}.webp`)));
if (stale.length) console.warn(`build-plates: ${stale.length} file(s) in ${outDir} no longer belong to a plate: ${stale.join(", ")}`);

console.log(`build-plates: ${written} files, ${(bytes / 1024).toFixed(0)} KB on disk in ${outDir}.`);
