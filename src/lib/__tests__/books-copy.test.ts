import { describe, expect, it } from "vitest";
import { booksCopy, feedsLabel, relativeMinutes, sideLabel } from "@/components/books-copy";

describe("books copy", () => {
  it("prints the side in the reader's language, for overs and unders alike", () => {
    expect(sideLabel("under", "en")).toBe("under");
    expect(sideLabel("over", "en")).toBe("over");
    expect(sideLabel("under", "pt")).toBe("menos de");
    expect(sideLabel("over", "pt")).toBe("mais de");
  });

  it("says how many feeds and books sit behind a median", () => {
    expect(feedsLabel(1, 4, "pt")).toBe("1 feed, 4 casas");
    expect(feedsLabel(2, 6, "en")).toBe("2 feeds, 6 books");
    expect(feedsLabel(1, 1, "en")).toBe("1 feed, 1 book");
  });

  it("says when the prices were read", () => {
    const now = Date.parse("2026-09-22T12:00:00Z");
    expect(relativeMinutes("2026-09-22T11:48:00Z", "pt", now)).toBe("há 12 min");
    expect(relativeMinutes("2026-09-22T11:48:00Z", "en", now)).toBe("12 min ago");
    expect(relativeMinutes("2026-09-22T09:00:00Z", "pt", now)).toBe("há 3 h");
    expect(relativeMinutes("2026-09-22T11:59:40Z", "en", now)).toBe("just now");
    expect(relativeMinutes(null, "pt", now)).toBe("");
  });

  it("keeps pt-BR and en in step", () => {
    for (const key of ["bestPrice", "whereToBet", "signals", "booksRead", "updated"] as const) {
      expect(booksCopy("pt")(key)).not.toBe(booksCopy("en")(key));
    }
  });
});
