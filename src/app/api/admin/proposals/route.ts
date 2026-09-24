import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/session";
import { approveProposal, appliedToday, listProposals, openProposals, rejectProposal, LEARN_MIN_DECIDED, type ProposalRow } from "@/lib/ledger/proposals";
import { measureApplied } from "@/lib/ledger/revert";
import { getPromptVersion, previousVersion, promptFreeze } from "@/lib/server/prompts";
import { DEFAULT_PROMPTS } from "@/lib/bets/prompt-defaults";
import { getDb } from "@/lib/server/db";
import type { PromptVersion } from "@/lib/server/prompts";
import { diffHunks, diffStats, lineDiff } from "@/lib/diff";
import { describeAiError } from "@/lib/ai/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The operator's queue. Everything the panel needs to decide is computed here, including the DIFF —
 * a proposal that arrives as a blob of prompt text is a proposal nobody reads, and approving
 * something nobody read is stamping. The diff is the stored rewrite against the prompt that is live
 * right now, so it is the change that would actually land.
 */
/**
 * What a proposal's diff is against depends on where it stands.
 *
 * Waiting for a decision, the question is "what would this do to the prompt that is live now", so it
 * is read against the active text. Already applied, that diff is empty by construction — the live
 * text IS this proposal — and the operator's question becomes "what did this version change", which
 * is the version it replaced. Showing the first diff on an applied row is how a panel says "nothing
 * changed" about the change it is describing.
 */
function baselineFor(row: ProposalRow, currentPt: string): string {
  if (row.status !== "applied" && row.status !== "reverted") return currentPt;
  const applied = row.promptVersionId
    ? (getDb().prepare("SELECT * FROM prompt_versions WHERE id=?").get(row.promptVersionId) as PromptVersion | undefined)
    : undefined;
  if (!applied) return currentPt;
  return previousVersion(applied.kind, applied.lang, applied.version)?.content ?? DEFAULT_PROMPTS[applied.kind][applied.lang];
}

const view = (row: ProposalRow, currentPt: string) => {
  const { contentPt, contentEn, evidence, ...rest } = row;
  const lines = rest.channel === "prompt" && contentPt ? lineDiff(baselineFor(row, currentPt), contentPt) : [];
  return {
    ...rest,
    evidence: safeJson(evidence),
    diff: lines.length ? { hunks: diffHunks(lines), stats: diffStats(lines) } : null,
    // The English side changes with it; the panel says so rather than showing two diffs nobody reads.
    hasEnglish: !!contentEn,
  };
};

const safeJson = (raw: string): Record<string, unknown> => {
  try { return JSON.parse(raw || "{}") as Record<string, unknown>; } catch { return {}; }
};

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "não autorizado" }, { status: 403 });

  const active = getPromptVersion("game", "pt");
  const measured = new Map(measureApplied().map((m) => [m.proposalId, m]));
  const all = listProposals(60);

  return NextResponse.json({
    minDecided: LEARN_MIN_DECIDED,
    freeze: promptFreeze("game"),
    appliedToday: appliedToday("game"),
    active: { id: active.id, version: active.version },
    queue: openProposals(40).map((r) => view(r, active.content)),
    applied: all.filter((r) => r.status === "applied").map((r) => ({ ...view(r, active.content), measurement: measured.get(r.id) ?? null })),
    history: all.filter((r) => ["rejected", "reverted", "under_gate", "stale"].includes(r.status)).map((r) => view(r, active.content)),
  });
}

const Body = z.object({
  id: z.string().max(80),
  action: z.enum(["approve", "reject"]),
  reason: z.string().max(600).optional(),
  override: z.boolean().optional(),
});

/** Approve or refuse one proposal. A refusal carries its reason, because that reason is data. */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "não autorizado" }, { status: 403 });
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });

  try {
    const out = parsed.data.action === "approve"
      ? approveProposal(parsed.data.id, admin.email, { override: parsed.data.override })
      : rejectProposal(parsed.data.id, admin.email, parsed.data.reason ?? "");
    return NextResponse.json(out, { status: out.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json({ error: describeAiError(error) ?? "falhou" }, { status: 502 });
  }
}
