import { describe, expect, it } from "vitest";
import { onDemandCaps, onDemandVerdict } from "@/lib/server/on-demand-policy";

const base = { role: "user" as const, planGamesPerDay: null, userCountToday: 0, globalCountToday: 0, globalDailyCap: 60, userDailyCap: 20, alreadyGenerated: false, started: false };

describe("onDemandVerdict", () => {
  it("never regenerates what exists, and never builds a started game", () => {
    expect(onDemandVerdict({ ...base, alreadyGenerated: true })).toBe("exists");
    expect(onDemandVerdict({ ...base, started: true })).toBe("started");
  });
  it("lets a user generate until the plan's daily allowance is used", () => {
    expect(onDemandVerdict({ ...base, planGamesPerDay: 1, userCountToday: 0 })).toBe("generate");
    expect(onDemandVerdict({ ...base, planGamesPerDay: 1, userCountToday: 1 })).toBe("cap_user");
  });
  it("falls back to the server's per-user cap when the plan is unlimited", () => {
    expect(onDemandVerdict({ ...base, userCountToday: 19 })).toBe("generate");
    expect(onDemandVerdict({ ...base, userCountToday: 20 })).toBe("cap_user");
  });
  it("the global cap wins over any plan, but not over the admin", () => {
    expect(onDemandVerdict({ ...base, globalCountToday: 60 })).toBe("cap_global");
    expect(onDemandVerdict({ ...base, globalCountToday: 60, role: "admin" })).toBe("generate");
  });
  it("reads caps from env with sane defaults", () => {
    expect(onDemandCaps({})).toEqual({ globalDailyCap: 60, userDailyCap: 20 });
    expect(onDemandCaps({ ON_DEMAND_DAILY_CAP: "10", ON_DEMAND_USER_DAILY_CAP: "2" })).toEqual({ globalDailyCap: 10, userDailyCap: 2 });
  });
});
