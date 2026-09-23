import { describe, expect, it } from "vitest";
import { DEFAULT_RECORD_START, recordStartDay, withinRecordWindow } from "@/lib/ledger/proof";

/**
 * The record speaks for one window and the page says which. Asked for on 23/09/2026: the product
 * before 21/09 was built by hand, on another sport, against another prompt, so averaging it into
 * today's number would describe something nobody can buy. It removes nothing from the current
 * record — the ledger's first ticket is already 22/09 — and exists so nothing older ever slips in.
 */

const entry = (day: string | undefined, created = "2026-10-01T00:00:00.000Z") => ({
  startsAt: day,
  createdAt: created,
});

describe("the window the public record speaks for", () => {
  it("starts on the day the platform began generating tickets itself", () => {
    expect(recordStartDay({})).toBe(DEFAULT_RECORD_START);
    expect(DEFAULT_RECORD_START).toBe("2026-09-21");
  });

  it("keeps everything from the start day onward and drops what came before", () => {
    // 2026-09-21T02:00Z is still 20/09 in Brasília (UTC−3), so it falls outside.
    const kept = withinRecordWindow(
      [
        entry("2026-09-19T23:00:00.000Z"),
        entry("2026-09-21T02:00:00.000Z"),
        entry("2026-09-22T00:00:00.000Z"),
        entry("2026-09-23T02:00:00.000Z"),
      ],
      {},
    );
    expect(kept.map((e) => e.startsAt)).toEqual(["2026-09-22T00:00:00.000Z", "2026-09-23T02:00:00.000Z"]);
  });

  it("falls back to when a ticket was written when it has no kickoff", () => {
    expect(withinRecordWindow([entry(undefined, "2026-09-10T12:00:00.000Z")], {})).toHaveLength(0);
    expect(withinRecordWindow([entry(undefined, "2026-09-25T12:00:00.000Z")], {})).toHaveLength(1);
  });

  it("moves when the operator moves it, and ignores anything that is not a date", () => {
    // Midnight UTC on the 24th is still the 23rd in Brasília, so only the midday one is inside.
    const rows = [entry("2026-09-22T00:00:00.000Z"), entry("2026-09-24T00:00:00.000Z"), entry("2026-09-24T12:00:00.000Z")];
    expect(withinRecordWindow(rows, { RECORD_START_DAY: "2026-09-24" }).map((e) => e.startsAt)).toEqual(["2026-09-24T12:00:00.000Z"]);
    expect(recordStartDay({ RECORD_START_DAY: "ontem" })).toBe(DEFAULT_RECORD_START);
    expect(recordStartDay({ RECORD_START_DAY: "" })).toBe(DEFAULT_RECORD_START);
  });
});
