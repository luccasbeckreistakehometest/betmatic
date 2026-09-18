#!/usr/bin/env node
/**
 * The design system's own lint. Every rule below exists because a screen broke it once and the
 * review found it in a screenshot rather than in a test (docs/DESIGN.md §17).
 *
 * It greps src/ for shapes that cannot be expressed as an ESLint rule: a token used for the wrong
 * tier, a raw value where a token exists, and the four visual clichés the brief bans. Run it in CI
 * and before a release: `node scripts/design-guard.mjs`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../src", import.meta.url).pathname;

/** Each rule is a matcher plus the reason, so a failure explains itself without opening the doc. */
const RULES = [
  {
    name: "fg-faint-as-content",
    why: "--fg-faint is the disabled tier (3.69:1 dark / 3.17:1 light) and fails AA as text. Use --fg-dim.",
    test: (line) => /(?<!disabled:)(?<!has-\[:disabled\]:)text-fg-faint/.test(line),
    allow: (file) => file.endsWith("DesignGallery.tsx"),
  },
  {
    name: "control-edge-off-token",
    why: "A control's edge must be --line-control (≥3:1). --line-strong is a rule, not an affordance.",
    test: (line) => /border-line-strong/.test(line) && /(<input|<select|<textarea|<button|role="radiogroup"|const (field|input|btn|button|select) =)/.test(line),
  },
  {
    // Arrows and the typographic marks (→ ✓ ✗ ·) are type, not emoji, and stay.
    name: "emoji",
    why: "An emoji is not an icon: public/icons.svg is the only icon source.",
    test: (line) => /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F0FF}]/u.test(line),
    onlyIn: (file) => file.endsWith(".tsx"),
  },
  {
    name: "banned-decoration",
    why: "Gradients, glass and uniform rounded-2xl are the AI-template tells the system exists to avoid.",
    test: (line) => /backdrop-blur|rounded-2xl|bg-gradient-to-|from-purple|drop-shadow-2xl/.test(line),
  },
  {
    name: "raw-colour",
    why: "No raw hex or arbitrary colour in a className: every colour is a token.",
    test: (line) => /(bg|text|border|fill|stroke)-\[#/.test(line),
  },
  {
    name: "toFixed-in-a-view",
    why: "Numbers on screen go through src/lib/format.ts, which knows the reader's locale.",
    test: (line) => /\.toFixed\(/.test(line),
    onlyIn: (file) => file.includes("/components/") || /\/app\/.*page\.tsx$/.test(file),
    allow: (file) => file.endsWith("Chart.tsx") || file.endsWith("PlayerChart.tsx"),
  },
];

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".tsx") || path.endsWith(".ts") ? [path] : [];
  });
}

let failures = 0;
for (const file of walk(ROOT)) {
  const rel = file.slice(ROOT.length - 3);
  const lines = readFileSync(file, "utf8").split("\n");
  for (const rule of RULES) {
    if (rule.allow?.(file)) continue;
    if (rule.onlyIn && !rule.onlyIn(file)) continue;
    lines.forEach((line, i) => {
      if (line.includes("design-guard-allow")) return;
      if (rule.test(line)) {
        failures += 1;
        console.error(`${rel}:${i + 1}  [${rule.name}] ${rule.why}\n    ${line.trim().slice(0, 140)}`);
      }
    });
  }
}

if (failures) {
  console.error(`\ndesign-guard: ${failures} violation${failures === 1 ? "" : "s"}.`);
  process.exit(1);
}
console.log("design-guard: clean.");
