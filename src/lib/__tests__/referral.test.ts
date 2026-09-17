import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-referral");
process.env.DATA_DIR = DIR; process.env.AUTH_SECRET = "test-secret-that-is-long-enough"; process.env.REFERRAL_DAILY_CAP = "1";
fs.rmSync(DIR, { recursive: true, force: true });
const { createUser, findById } = await import("@/lib/server/users");
const { recordReferral, creditReferralOnPurchase, refCodeFor, referralStats, userByRefCode, REFERRAL_COINS } = await import("@/lib/server/referral");

const alice = await createUser({ email: "alice@x.com", name: "Alice", password: "password123" });

describe("referral", () => {
  it("a new signup is never an admin", async () => {
    const first = await createUser({ email: "first@x.com", name: "First", password: "password123" });
    expect(first.role).toBe("user");
  });

  it("codes are short, stable and resolve back to the user", () => {
    expect(refCodeFor(alice.id)).toHaveLength(8);
    expect(refCodeFor(alice.id)).toBe(refCodeFor(alice.id));
    expect(userByRefCode(refCodeFor(alice.id))?.id).toBe(alice.id);
    expect(userByRefCode("nope")).toBeNull();
  });

  it("a signup only records the referral; coins arrive with the first paid purchase", async () => {
    const bob = await createUser({ email: "bob@x.com", name: "Bob", password: "password123" });
    expect(recordReferral(bob.id, refCodeFor(alice.id))).toEqual({ referrerId: alice.id });
    expect(recordReferral(bob.id, refCodeFor(alice.id))).toBeNull(); // once per referred account
    expect(recordReferral(bob.id, refCodeFor(bob.id))).toBeNull();
    expect(recordReferral(bob.id, undefined)).toBeNull();
    expect(findById(alice.id)!.coins).toBe(0);
    expect(findById(bob.id)!.coins).toBe(0);
    expect(referralStats(alice.id)).toMatchObject({ invited: 1, converted: 0, coinsEarned: 0 });

    expect(creditReferralOnPurchase(bob.id, "pay_1")).toBe("credited");
    expect(findById(alice.id)!.coins).toBe(REFERRAL_COINS);
    expect(findById(bob.id)!.coins).toBe(REFERRAL_COINS);
    // A second purchase pays nothing more.
    expect(creditReferralOnPurchase(bob.id, "pay_2")).toBeNull();
    expect(referralStats(alice.id)).toMatchObject({ invited: 1, converted: 1, coinsEarned: REFERRAL_COINS });
  });

  it("the referrer is capped per day; the referred user still gets the welcome coins", async () => {
    const carol = await createUser({ email: "carol@x.com", name: "Carol", password: "password123" });
    recordReferral(carol.id, refCodeFor(alice.id));
    expect(creditReferralOnPurchase(carol.id, "pay_3")).toBe("capped");
    expect(findById(alice.id)!.coins).toBe(REFERRAL_COINS);
    expect(findById(carol.id)!.coins).toBe(REFERRAL_COINS);
  });
});
