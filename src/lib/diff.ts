/**
 * A line diff, so an operator approving a prompt change reads the exact text that will go live.
 *
 * The panel used to show the FEEDBACK ("pare de ancorar cartões na média do árbitro") and call it a
 * proposal, but the feedback is an instruction to the rewriter, not the change: what actually landed
 * in the prompt was whatever the rewriter chose to write, and nobody saw it until after it was live.
 * Approving that is stamping, not approving. So the rewrite is computed when the proposal is
 * written, stored beside it, and rendered here against the prompt it replaces.
 */

export type DiffOp = "same" | "add" | "remove";
export interface DiffLine {
  op: DiffOp;
  text: string;
  /** 1-based line number in the "before" text, for a removed or unchanged line. */
  before: number | null;
  /** 1-based line number in the "after" text, for an added or unchanged line. */
  after: number | null;
}

/**
 * Above this many lines on either side the quadratic table is abandoned and the two texts are
 * reported as one wholesale replacement. A generation prompt is a few hundred lines, so this is a
 * guard against a pathological input, not a case the panel is expected to hit.
 */
export const DIFF_MAX_LINES = 2000;

/** Longest common subsequence over lines, as the table of match lengths. */
function lcsTable(a: string[], b: string[]): Uint32Array {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  return table;
}

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES) {
    return [
      ...a.map((text, i): DiffLine => ({ op: "remove", text, before: i + 1, after: null })),
      ...b.map((text, i): DiffLine => ({ op: "add", text, before: null, after: i + 1 })),
    ];
  }

  const table = lcsTable(a, b);
  const width = b.length + 1;
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i], before: i + 1, after: j + 1 });
      i += 1; j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      out.push({ op: "remove", text: a[i], before: i + 1, after: null });
      i += 1;
    } else {
      out.push({ op: "add", text: b[j], before: null, after: j + 1 });
      j += 1;
    }
  }
  while (i < a.length) { out.push({ op: "remove", text: a[i], before: i + 1, after: null }); i += 1; }
  while (j < b.length) { out.push({ op: "add", text: b[j], before: null, after: j + 1 }); j += 1; }
  return out;
}

export interface DiffStats { added: number; removed: number; same: number }

export const diffStats = (lines: DiffLine[]): DiffStats => ({
  added: lines.filter((l) => l.op === "add").length,
  removed: lines.filter((l) => l.op === "remove").length,
  same: lines.filter((l) => l.op === "same").length,
});

/**
 * The changed regions with `context` unchanged lines around each, so a 400-line prompt whose change
 * is one paragraph renders as that paragraph. A gap between two hunks is reported as its own hunk of
 * one marker line, because a diff that silently skips 200 lines reads as if they were unchanged
 * without ever saying so.
 */
export function diffHunks(lines: DiffLine[], context = 3): DiffLine[][] {
  const changed = lines.map((l) => l.op !== "same");
  if (!changed.some(Boolean)) return [];

  const keep = lines.map((_, i) =>
    changed.slice(Math.max(0, i - context), i + context + 1).some(Boolean));

  const hunks: DiffLine[][] = [];
  let current: DiffLine[] | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (!keep[i]) { current = null; continue; }
    if (!current) { current = []; hunks.push(current); }
    current.push(lines[i]);
  }
  return hunks;
}
