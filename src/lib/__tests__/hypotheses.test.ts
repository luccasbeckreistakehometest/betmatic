import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-hypotheses");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });

const { contradicts, fingerprintOf, listHypotheses, markApplied, proposeHypothesis, unblockHypothesis } = await import("@/lib/ledger/hypotheses");
const { getDb } = await import("@/lib/server/db");

/**
 * The memory that stops the learning loop from proposing the same idea for the fourth time, and from
 * quietly applying a rule that reverses one already live. Both failures are silent without this
 * table: the prompt just grows contradictory paragraphs nobody can read.
 */

const KNOWN = new Set(["f1", "f2"]);
const base = { dim: "stat", value: "PRA", direction: "lower" as const, bucket: "pregame-main", factorStatId: "f1", text: "confiar menos em PRA" };

beforeEach(() => { getDb().prepare("DELETE FROM rule_hypotheses").run(); });

describe("a proposal has to cite a measurement", () => {
  it("refuses one that cites nothing, and one that cites a row that does not exist", () => {
    expect(proposeHypothesis({ ...base, factorStatId: "" }, KNOWN).status).toBe("unsupported");
    expect(proposeHypothesis({ ...base, factorStatId: "ghost" }, KNOWN).status).toBe("unsupported");
    expect(listHypotheses()).toHaveLength(0);
  });

  it("stores one that cites a real row", () => {
    const out = proposeHypothesis(base, KNOWN);
    expect(out.status).toBe("stored");
    expect(out.hypothesis).toMatchObject({ dim: "stat", value: "PRA", status: "proposed", factorStatId: "f1" });
  });
});

describe("the same idea in different words", () => {
  it("hashes to the same fingerprint", () => {
    expect(fingerprintOf(base)).toBe(fingerprintOf({ ...base, direction: "lower" }));
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, direction: "raise" }));
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, bucket: "live" }));
  });

  it("is refused as a duplicate and points at the row it repeats", () => {
    const first = proposeHypothesis(base, KNOWN);
    const again = proposeHypothesis({ ...base, text: "outra redação da mesma coisa" }, KNOWN);
    expect(again.status).toBe("duplicate");
    expect(again.previous?.id).toBe(first.hypothesis!.id);
    expect(again.note).toContain("já proposta");
    expect(listHypotheses()).toHaveLength(1);
  });
});

describe("a proposal that reverses a live rule", () => {
  it("is recognised as a contradiction", () => {
    expect(contradicts({ ...base }, { ...base, direction: "raise" })).toBe(true);
    expect(contradicts({ ...base }, { ...base, direction: "lower" })).toBe(false);
    // Different slice, opposite direction: not a contradiction, just two unrelated rules.
    expect(contradicts({ ...base }, { ...base, value: "PTS", direction: "raise" })).toBe(false);
  });

  it("is stored as blocked, never as a silent cancellation", () => {
    const live = proposeHypothesis(base, KNOWN);
    markApplied(live.hypothesis!.id, "pv1", "admin");
    const reverse = proposeHypothesis({ ...base, direction: "raise", factorStatId: "f2", text: "confiar mais em PRA" }, KNOWN);
    expect(reverse.status).toBe("blocked");
    expect(reverse.hypothesis?.status).toBe("blocked");
    expect(reverse.previous?.id).toBe(live.hypothesis!.id);
  });

  it("is never applied by a job, only unblocked by a person", () => {
    const live = proposeHypothesis(base, KNOWN);
    markApplied(live.hypothesis!.id, "pv1", "admin");
    const blocked = proposeHypothesis({ ...base, direction: "raise", factorStatId: "f2" }, KNOWN).hypothesis!;

    // LEARN_AUTO_APPLY reaches markApplied; a blocked row refuses it.
    expect(markApplied(blocked.id, "pv2", "agente (aprendizado)")).toBeNull();
    expect(listHypotheses().find((h) => h.id === blocked.id)?.status).toBe("blocked");

    expect(unblockHypothesis(blocked.id, "admin (desbloqueio manual)")?.status).toBe("proposed");
    expect(markApplied(blocked.id, "pv2", "admin")?.status).toBe("applied");
  });

  it("only unblocks something that was blocked", () => {
    const row = proposeHypothesis(base, KNOWN).hypothesis!;
    expect(unblockHypothesis(row.id, "admin")).toBeNull();
  });
});
