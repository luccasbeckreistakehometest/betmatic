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

describe("slateVerdict", async () => {
  const { slateVerdict, slateCaps } = await import("@/lib/server/on-demand-policy");
  const caps = slateCaps({});
  const base = { role: "user" as const, crossGame: true, exists: false, upcomingGames: 4, globalCountToday: 0, userCountToday: 0, caps };
  it("covers every branch in order", () => {
    expect(caps).toEqual({ globalDailyCap: 5, userDailyCap: 2, maxGames: 6 });
    expect(slateVerdict({ ...base, crossGame: false })).toBe("not_allowed");
    expect(slateVerdict({ ...base, crossGame: false, role: "admin" })).toBe("generate");
    expect(slateVerdict({ ...base, exists: true })).toBe("exists");
    expect(slateVerdict({ ...base, upcomingGames: 1 })).toBe("too_few_games");
    expect(slateVerdict({ ...base, globalCountToday: 5 })).toBe("cap_global");
    expect(slateVerdict({ ...base, userCountToday: 2 })).toBe("cap_user");
    expect(slateVerdict({ ...base, globalCountToday: 99, role: "admin" })).toBe("generate");
    expect(slateVerdict(base)).toBe("generate");
  });
  it("reads the caps from env", () => {
    expect(slateCaps({ SLATE_DAILY_CAP: "0", SLATE_USER_DAILY_CAP: "1", SLATE_MAX_GAMES: "50" })).toEqual({ globalDailyCap: 0, userDailyCap: 1, maxGames: 10 });
  });
});
