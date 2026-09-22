import { describe, expect, it } from "vitest";
import { signedLine } from "@/components/GameCard";

// A −1800 moneyline printed as "−1.800" on a Brazilian phone reads as the decimal odd 1,800 — the
// other side of the bet. American prices carry a sign and digits, nothing else.
describe("American prices on the game card", () => {
  it("never groups the thousands, in either language", () => {
    expect(signedLine(-1800, "pt")).toBe("\u22121800");
    expect(signedLine(1000, "pt")).toBe("+1000");
    expect(signedLine(-1800, "en")).toBe("\u22121800");
    expect(signedLine(130, "en")).toBe("+130");
    expect(signedLine(-115.4, "pt")).toBe("\u2212115");
  });
  it("shows the dash when nothing is posted", () => {
    expect(signedLine(undefined, "pt")).toBe(signedLine(Number.NaN, "pt"));
  });
});
