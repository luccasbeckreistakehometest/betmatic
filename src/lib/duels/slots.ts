/**
 * Positional slots derived from a formation string plus lineup order.
 *
 * Sofascore does not publish an explicit slot, but its `players` array is ordered by line:
 * keeper first, then each line of the formation in turn. The line a player belongs to is therefore
 * reliable. The flank within a line is an inference from ordering convention — it is labelled as
 * such so nothing downstream treats it as ground truth.
 */
export type Line = "gk" | "def" | "mid" | "att";
export type Flank = "right" | "centre" | "left";

export interface Slot {
  index: number;
  name: string;
  line: Line;
  flank: Flank;
  /** How much to trust the flank call. Full-backs in a flat four are the safest case. */
  flankConfidence: "high" | "medium" | "low";
  label: string;
}

const LINE_ORDER: Line[] = ["def", "mid", "att"];

/** "4-2-3-1" → [4, 2, 3, 1]. Anything unparseable yields an empty plan. */
export function parseFormation(formation: string | undefined): number[] {
  if (!formation) return [];
  const parts = formation.split(/[-–]/).map((p) => Number(p.trim()));
  return parts.every((n) => Number.isFinite(n) && n > 0) ? parts : [];
}

function flankFor(indexInLine: number, lineSize: number): { flank: Flank; confidence: Slot["flankConfidence"] } {
  if (lineSize <= 1) return { flank: "centre", confidence: "high" };
  if (lineSize === 2) {
    // A pair is almost always a partnership rather than two flanks.
    return { flank: "centre", confidence: "low" };
  }
  if (indexInLine === 0) return { flank: "right", confidence: lineSize >= 4 ? "high" : "medium" };
  if (indexInLine === lineSize - 1) return { flank: "left", confidence: lineSize >= 4 ? "high" : "medium" };
  return { flank: "centre", confidence: "high" };
}

const LINE_LABEL: Record<Line, Record<Flank, string>> = {
  gk: { right: "GK", centre: "GK", left: "GK" },
  def: { right: "Lateral direito", centre: "Zagueiro", left: "Lateral esquerdo" },
  mid: { right: "Meia direita", centre: "Meio-campo", left: "Meia esquerda" },
  att: { right: "Ponta direita", centre: "Centroavante", left: "Ponta esquerda" },
};

/**
 * Maps starters onto slots. Only starters are placed: a substitute has no position on the pitch
 * at kickoff, and pairing one would invent a duel that never happens.
 */
export function deriveSlots(
  formation: string | undefined,
  players: { name: string; substitute?: boolean }[],
): Slot[] {
  const lines = parseFormation(formation);
  const starters = players.filter((p) => !p.substitute);
  if (!lines.length || starters.length < 11) return [];

  const slots: Slot[] = [];
  // Index 0 is the keeper in every formation string, which counts only outfield lines.
  slots.push({
    index: 0,
    name: starters[0].name,
    line: "gk",
    flank: "centre",
    flankConfidence: "high",
    label: "Goleiro",
  });

  let cursor = 1;
  lines.forEach((lineSize, lineIdx) => {
    // Formations with four numbers (4-2-3-1) split midfield into two bands; both are "mid"
    // except the final band, which is the attack.
    const line: Line = lineIdx === lines.length - 1 ? "att" : LINE_ORDER[Math.min(lineIdx, 1)];
    for (let i = 0; i < lineSize; i += 1) {
      const player = starters[cursor];
      if (!player) return;
      const { flank, confidence } = flankFor(i, lineSize);
      slots.push({
        index: cursor,
        name: player.name,
        line,
        flank,
        flankConfidence: confidence,
        label: LINE_LABEL[line][flank],
      });
      cursor += 1;
    }
  });

  return slots;
}

/** Attackers meet the defender on the mirrored flank; a right winger faces the left-back. */
export function mirrorFlank(flank: Flank): Flank {
  if (flank === "right") return "left";
  if (flank === "left") return "right";
  return "centre";
}
