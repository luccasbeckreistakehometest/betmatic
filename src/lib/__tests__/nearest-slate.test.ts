import { describe, expect, it } from "vitest";
import { nearestCandidates } from "@/lib/sources/espn";

describe("nearestCandidates", () => {
  it("from today, tries the next round before yesterday's finished games", () => {
    expect(nearestCandidates("20260917", "20260917", ["20260920", "20260921"], ["20260916", "20260913"]))
      .toEqual(["20260920", "20260921", "20260916", "20260913"]);
  });
  it("for a past date, the closest day wins and ties go forward", () => {
    expect(nearestCandidates("20260910", "20260917", ["20260912", "20260911"].sort(), ["20260909", "20260905"]))
      .toEqual(["20260911", "20260909", "20260912", "20260905"]);
  });
  it("never probes more than six days", () => {
    const days = Array.from({ length: 8 }, (_, i) => `2026092${i}`);
    expect(nearestCandidates("20260917", "20260917", days, days)).toHaveLength(6);
  });
});
