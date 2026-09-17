import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-referral");
process.env.DATA_DIR = DIR; process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });
const { createUser, findById } = await import("@/lib/server/users");
const { creditReferral, refCodeFor, referralStats, userByRefCode, REFERRAL_COINS } = await import("@/lib/server/referral");

describe("referral", () => {
  const admin = createUser({ email: "a@x.com", name: "A", password: "password123" }); // first = admin
  const alice = createUser({ email: "alice@x.com", name: "Alice", password: "password123" });
  it("codes are short, stable and resolve back to the user", () => {
    expect(refCodeFor(alice.id)).toHaveLength(8);
    expect(refCodeFor(alice.id)).toBe(refCodeFor(alice.id));
    expect(userByRefCode(refCodeFor(alice.id))?.id).toBe(alice.id);
    expect(userByRefCode("nope")).toBeNull();
    void admin;
  });
  it("credits both sides once, and never for self or unknown codes", () => {
    const bob = createUser({ email: "bob@x.com", name: "Bob", password: "password123" });
    expect(creditReferral(bob.id, refCodeFor(alice.id))).toEqual({ referrerId: alice.id });
    expect(findById(alice.id)!.coins).toBe(REFERRAL_COINS);
    expect(findById(bob.id)!.coins).toBe(REFERRAL_COINS);
    expect(() => creditReferral(bob.id, refCodeFor(alice.id))).toThrow(); // UNIQUE(referredId)
    expect(creditReferral(bob.id, refCodeFor(bob.id))).toBeNull();
    expect(creditReferral(bob.id, undefined)).toBeNull();
    expect(referralStats(alice.id)).toEqual({ code: refCodeFor(alice.id), invited: 1, coinsEarned: REFERRAL_COINS });
  });
});
