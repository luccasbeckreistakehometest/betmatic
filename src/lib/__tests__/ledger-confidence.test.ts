import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { BetSuggestion, Game } from "@/lib/types";

/**
 * Written on 23/09/2026. The selection layer reads a ticket's `confidence` — it is one of its cuts
 * — and the only copy lived inside the stored slate, which holds one row per game and language and
 * is OVERWRITTEN on regeneration. Game 401857209 was rebuilt at 23:57 on 22/09 and took the
 * suggestion ids of twelve already-served tickets with it: their confidence became unrecoverable,
 * and six of the twelve sat inside the wallet's own window. The ledger is append-only, so the copy
 * belongs here.
 */

const DIR = path.join(process.cwd(), "data", "unit-confidence");
process.env.DATA_DIR = DIR;
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(DIR, "ledger"), { recursive: true });
fs.writeFileSync(path.join(DIR, "ledger", "predictions.jsonl"), "", "utf8");

const { recordPredictions, readLedger } = await import("@/lib/ledger/store");

const game = {
  id: "401857209", sportKey: "wnba", startsAt: "2026-09-23T00:00:00.000Z", status: "scheduled",
  statusDetail: "Scheduled",
  home: { id: "5", abbreviation: "IND", name: "Fever", displayName: "Indiana Fever" },
  away: { id: "8", abbreviation: "MIN", name: "Lynx", displayName: "Minnesota Lynx" },
} as unknown as Game;

const suggestion = (id: string, confidence?: "high" | "medium" | "low") => ({
  id, bandKey: "value", kind: "single", title: "t", combinedDecimal: 1.9,
  modelledProbability: 0.55, evidenceScore: 80, ...(confidence ? { confidence } : {}),
  // The ledger id is game + band + leg text, so two tickets of the same shape are one ticket.
  legs: [{ selection: `Alguém mais de 10,5 pontos (${id})`, market: "player_prop", odds: "1.90", oddsDecimal: 1.9, explanation: "", evidence: "", fairProbability: 0.55 }],
}) as unknown as BetSuggestion;

describe("what the ledger keeps about a ticket", () => {
  it("files the generator's confidence, so regenerating the game cannot take it away", () => {
    recordPredictions(game, [suggestion("a", "high"), suggestion("b", "low")]);
    const rows = readLedger();
    expect(rows.map((e) => e.confidence)).toEqual(["high", "low"]);
  });

  it("leaves the field off rather than inventing one when the generator gave none", () => {
    recordPredictions(game, [suggestion("c")]);
    const row = readLedger().find((e) => e.suggestionId === "c")!;
    expect(row).not.toHaveProperty("confidence");
  });
});
