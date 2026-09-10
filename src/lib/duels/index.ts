import { deriveSlots, mirrorFlank, type Slot } from "@/lib/duels/slots";
import { measureProp } from "@/lib/props/history";
import type { PlayerHistory } from "@/lib/types";

export interface DuelPlayer {
  name: string;
  slot: Slot;
  /** Per-game rates measured from the game log. */
  rates: Record<string, number>;
  games: number;
}

export type DuelAngle = "cards" | "fouls" | "shots" | "aerial" | "none";

export interface Duel {
  home: DuelPlayer;
  away: DuelPlayer;
  matchup: string;
  /** 0-100. How much friction this pairing is likely to generate. */
  friction: number;
  angle: DuelAngle;
  /** Markets this duel makes interesting, in the sport's own vocabulary. */
  markets: string[];
  evidence: string;
  confidence: "high" | "medium" | "low";
}

/** Mean of a stat across the logged games, which is what a per-game rate means. */
function rate(history: PlayerHistory, market: string, sportKey: string): number {
  const measured = measureProp(history, market, 0.5, "over", sportKey);
  return measured ? measured.average : NaN;
}

export function buildDuelPlayer(
  slot: Slot,
  history: PlayerHistory | null,
  sportKey: string,
  markets: string[],
): DuelPlayer | null {
  if (!history || history.games.length < 3) return null;
  const rates: Record<string, number> = {};
  for (const market of markets) {
    const value = rate(history, market, sportKey);
    if (Number.isFinite(value)) rates[market] = Number(value.toFixed(2));
  }
  return { name: slot.name, slot, rates, games: history.games.length };
}

/**
 * Scores one pairing. The insight the model is built on: a player who draws many fouls facing a
 * player who commits many is a compounding situation, not two independent numbers — the market
 * prices each player's line separately and rarely prices the meeting.
 */
function scoreSoccerDuel(home: DuelPlayer, away: DuelPlayer): Omit<Duel, "home" | "away" | "matchup"> {
  const drawn = (home.rates["Fouls Suffered"] ?? 0) + (away.rates["Fouls Suffered"] ?? 0);
  const committed = (home.rates["Fouls Committed"] ?? 0) + (away.rates["Fouls Committed"] ?? 0);
  const cards = (home.rates["Yellow Card"] ?? 0) + (away.rates["Yellow Card"] ?? 0);

  // Friction is the smaller of the two sides: a foul needs someone to draw it AND someone to
  // commit it. Taking the max would let one extreme player carry a pairing that has no meeting.
  const meeting = Math.min(drawn, committed);
  const friction = Math.round(Math.min(100, meeting * 18 + cards * 60));

  let angle: DuelAngle = "none";
  const markets: string[] = [];
  if (cards >= 0.25 && meeting >= 1.5) {
    angle = "cards";
    markets.push("Cartão amarelo", "Faltas cometidas");
  } else if (meeting >= 2) {
    angle = "fouls";
    markets.push("Faltas cometidas", "Faltas sofridas");
  }

  const sample = Math.min(home.games, away.games);
  const confidence = sample >= 10 ? "high" : sample >= 5 ? "medium" : "low";

  return {
    friction,
    angle,
    markets,
    confidence,
    evidence: [
      `${home.name}: ${home.rates["Fouls Suffered"] ?? 0} faltas sofridas e ${home.rates["Fouls Committed"] ?? 0} cometidas por jogo`,
      `${away.name}: ${away.rates["Fouls Suffered"] ?? 0} sofridas e ${away.rates["Fouls Committed"] ?? 0} cometidas`,
      `amostra de ${sample} jogos`,
    ].join(" · "),
  };
}

export interface DuelInput {
  sportKey: string;
  homeFormation: string | undefined;
  awayFormation: string | undefined;
  homePlayers: { name: string; substitute?: boolean }[];
  awayPlayers: { name: string; substitute?: boolean }[];
  /** Resolves a player's game log by name. */
  historyFor: (name: string, side: "home" | "away") => PlayerHistory | null;
}

const SOCCER_MARKETS = ["Fouls Committed", "Fouls Suffered", "Yellow Card", "Shots", "Shots on Target"];

/**
 * Pairs opposing players by mirrored flank and ranks the resulting duels by friction.
 * Only pairings where both sides have a real sample survive.
 */
export function buildDuels(input: DuelInput): Duel[] {
  const homeSlots = deriveSlots(input.homeFormation, input.homePlayers);
  const awaySlots = deriveSlots(input.awayFormation, input.awayPlayers);
  if (!homeSlots.length || !awaySlots.length) return [];

  const duels: Duel[] = [];

  for (const attacker of homeSlots.filter((s) => s.line === "att" || s.line === "mid")) {
    // The defender on the mirrored flank is the one who actually meets him.
    const opponent = awaySlots.find(
      (s) => s.line === "def" && s.flank === mirrorFlank(attacker.flank),
    );
    if (!opponent) continue;

    const home = buildDuelPlayer(attacker, input.historyFor(attacker.name, "home"), input.sportKey, SOCCER_MARKETS);
    const away = buildDuelPlayer(opponent, input.historyFor(opponent.name, "away"), input.sportKey, SOCCER_MARKETS);
    if (!home || !away) continue;

    const scored = scoreSoccerDuel(home, away);
    if (scored.angle === "none") continue;

    // A low-confidence flank call means we might be pairing the wrong two players entirely.
    const confidence =
      attacker.flankConfidence === "low" || opponent.flankConfidence === "low" ? "low" : scored.confidence;

    duels.push({
      home,
      away,
      matchup: `${attacker.label} × ${opponent.label}`,
      ...scored,
      confidence,
    });
  }

  return duels.sort((a, b) => b.friction - a.friction);
}

/** Prompt block so the ticket builder can reason over duels alongside everything else. */
export function duelsPrompt(duels: Duel[]): string {
  if (!duels.length) return "POSITIONAL DUELS: none derived (no lineup or not enough history).";
  return [
    "POSITIONAL DUELS — opposing players who meet directly. Each was measured, not assumed:",
    ...duels
      .slice(0, 6)
      .map(
        (d) =>
          `- ${d.matchup}: ${d.home.name} vs ${d.away.name} | friction ${d.friction}/100 | angle ${d.angle} | ${d.evidence} | flank confidence ${d.confidence}`,
      ),
    "A duel sharpens a card or foul lean the referee already supports; it is not a reason on its own. Ignore any duel whose flank confidence is low, and only use one whose markets are actually offered.",
  ].join("\n");
}
