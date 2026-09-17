import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { espnJson, fixtureKey } from "@/lib/sources/espn-http";
import { aiMockActive, supportsAdaptiveThinking } from "@/lib/ai/client";
import { startupProblems } from "@/lib/env";

describe("ESPN fixture replay", () => {
  it("flattens a URL into a stable file name", () => {
    expect(fixtureKey("https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=990000101"))
      .toBe("site_api_espn_com_apis_site_v2_sports_basketball_wnba_summary_event_990000101");
  });

  it("answers from disk when a fixture exists, including a failing upstream", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "espn-fx-"));
    const ok = "https://example.test/a?b=1";
    const bad = "https://example.test/down";
    fs.writeFileSync(path.join(dir, `${fixtureKey(ok)}.json`), JSON.stringify({ hello: "world" }));
    fs.writeFileSync(path.join(dir, `${fixtureKey(bad)}.json`), JSON.stringify({ __status: 503 }));
    const before = process.env.ESPN_FIXTURES;
    process.env.ESPN_FIXTURES = dir;
    try {
      expect(await espnJson(ok)).toEqual({ hello: "world" });
      await expect(espnJson(bad)).rejects.toThrow(/ESPN 503/);
    } finally {
      process.env.ESPN_FIXTURES = before;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("AI mock switch", () => {
  it("is off by default, always on with 1, and file-gated with switch", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-mock-"));
    try {
      expect(aiMockActive({})).toBe(false);
      expect(aiMockActive({ AI_MOCK: "1" })).toBe(true);
      expect(aiMockActive({ AI_MOCK: "switch", DATA_DIR: dir })).toBe(false);
      fs.writeFileSync(path.join(dir, "ai-mock.on"), "");
      expect(aiMockActive({ AI_MOCK: "switch", DATA_DIR: dir })).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never sends adaptive thinking to Haiku", () => {
    expect(supportsAdaptiveThinking("claude-haiku-4-5")).toBe(false);
    expect(supportsAdaptiveThinking("claude-sonnet-5")).toBe(true);
  });

  it("refuses the test switches in production", () => {
    const base = { AUTH_SECRET: "x".repeat(40) };
    expect(startupProblems({ ...base, AI_MOCK: "1" }).fatal.join(" ")).toMatch(/AI_MOCK/);
    expect(startupProblems({ ...base, ESPN_FIXTURES: "/tmp/x" }).fatal.join(" ")).toMatch(/ESPN_FIXTURES/);
    expect(startupProblems(base).fatal).toEqual([]);
  });
});
