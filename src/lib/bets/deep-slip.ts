import { mentionsDraw, mentionsWin, parseLine, playerMention, teamMention, type TeamLike } from "@/lib/resolve/names";
import { resolveStatLabels } from "@/lib/props/history";
import { marketsFor } from "@/lib/sports";

/**
 * Deep slip analysis, the deterministic half: each typed leg is matched to a game, a team or a
 * player, then (server side) enriched with measured numbers. The model only judges afterwards.
 */
export interface GameContext {
  id: string;
  sportKey: string;
  startsAt: string;
  home: TeamLike & { id: string };
  away: TeamLike & { id: string };
  athletes: { id: string; name: string; team: string }[];
}

export type LegKind = "player" | "moneyline" | "draw" | "total" | "unknown";

export interface ResolvedLeg {
  index: number;
  kind: LegKind;
  gameId: string | null;
  matchup: string | null;
  athleteId: string | null;
  player: string | null;
  /** Abbreviation of the team the leg is about (the player's team for a player leg). */
  team: string | null;
  marketKey: string | null;
  line: number | null;
  side: "over" | "under" | null;
  /** How the match was made: typed text, or the cheap-model parse as a fallback. */
  via: "text" | "parse" | null;
}

export interface TypedLeg { selection: string; market: string; odds: string }
/** What the cheap parse returns for a leg the text matcher could not place. */
export interface ParsedLeg { index: number; player: string | null; team: string | null; stat: string | null; line: number | null; side: "over" | "under" | null }

const matchupOf = (g: GameContext) => `${g.away.displayName} @ ${g.home.displayName}`;

/** The market key for a stat phrase in the leg's sport ("pontos" → points, "finalizações" → shots). */
export function marketKeyFor(text: string, sportKey: string): string | null {
  const markets = marketsFor(sportKey).filter((m) => m.statLabels.length && m.key !== "minutes");
  const lower = text.toLowerCase();
  // Longest label first so "Pontos + Rebotes" is not read as "Pontos".
  const byLabel = [...markets].sort((a, b) => b.label.pt.length - a.label.pt.length)
    .find((m) => lower.includes(m.label.pt.toLowerCase()) || lower.includes(m.label.en.toLowerCase()));
  if (byLabel) return byLabel.key;
  for (const word of lower.split(/[^a-zà-ú0-9+]+/).filter((w) => w.length > 1)) {
    const labels = resolveStatLabels(word, sportKey);
    const hit = labels && markets.find((m) => JSON.stringify(m.statLabels) === JSON.stringify(labels));
    if (hit) return hit.key;
  }
  return null;
}

const empty = (index: number): ResolvedLeg => ({ index, kind: "unknown", gameId: null, matchup: null, athleteId: null, player: null, team: null, marketKey: null, line: null, side: null, via: null });

/** Matches a typed leg to one of the upcoming games. Unknown when nothing is certain. */
export function resolveTypedLeg(leg: TypedLeg, index: number, games: GameContext[]): ResolvedLeg {
  const text = `${leg.selection} ${leg.market}`;
  const parsedLine = parseLine(text);
  for (const g of games) {
    const athlete = playerMention(text, g.athletes);
    if (!athlete) continue;
    const marketKey = marketKeyFor(text, g.sportKey);
    return { ...empty(index), kind: "player", gameId: g.id, matchup: matchupOf(g), athleteId: athlete.id, player: athlete.name, team: athlete.team, marketKey, line: parsedLine?.line ?? null, side: parsedLine?.side ?? null, via: "text" };
  }
  const scored = games
    .map((g) => ({ g, home: teamMention(text, g.home), away: teamMention(text, g.away) }))
    .filter((s) => s.home || s.away)
    .sort((a, b) => Math.max(b.home, b.away) - Math.max(a.home, a.away));
  const hit = scored[0];
  if (!hit) return empty(index);
  const base = { ...empty(index), gameId: hit.g.id, matchup: matchupOf(hit.g), via: "text" as const };
  if (parsedLine && !mentionsWin(text)) return { ...base, kind: "total", team: hit.home && hit.away ? null : hit.home >= hit.away ? hit.g.home.abbreviation : hit.g.away.abbreviation, line: parsedLine.line, side: parsedLine.side };
  if (mentionsDraw(text)) return { ...base, kind: "draw" };
  const team = hit.home >= hit.away ? hit.g.home : hit.g.away;
  return { ...base, kind: "moneyline", team: team.abbreviation };
}

/** Places a leg from the cheap model's structured parse (names still matched against ESPN here). */
export function resolveParsedLeg(parsed: ParsedLeg, games: GameContext[]): ResolvedLeg {
  const text = [parsed.player, parsed.team].filter(Boolean).join(" ");
  if (!text) return empty(parsed.index);
  const synthetic = `${text} ${parsed.stat ?? ""} ${parsed.side === "under" ? "under" : parsed.side === "over" ? "over" : ""} ${parsed.line ?? ""}`;
  const r = resolveTypedLeg({ selection: synthetic, market: "", odds: "" }, parsed.index, games);
  return r.kind === "unknown" ? r : { ...r, via: "parse" };
}

export interface CorrelationFlag { kind: "same_team" | "same_player" | "fights"; legs: [number, number] }

/**
 * Legs that move together (the book discounts them in "Criar Aposta") or against each other.
 * `favourite` is the team abbreviation the market favours in each game.
 */
export function correlationFlags(legs: ResolvedLeg[], favourite: Record<string, string | null> = {}): CorrelationFlag[] {
  const flags: CorrelationFlag[] = [];
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i];
      const b = legs[j];
      if (!a.gameId || a.gameId !== b.gameId) continue;
      if (a.kind === "player" && b.kind === "player") {
        if (a.athleteId === b.athleteId) flags.push({ kind: "same_player", legs: [a.index, b.index] });
        else if (a.team && a.team === b.team) flags.push({ kind: "same_team", legs: [a.index, b.index] });
        continue;
      }
      const ml = a.kind === "moneyline" ? a : b.kind === "moneyline" ? b : null;
      const total = a.kind === "total" ? a : b.kind === "total" ? b : null;
      if (ml && total && total.side === "under" && favourite[ml.gameId!] === ml.team && (!total.team || total.team === ml.team)) {
        flags.push({ kind: "fights", legs: [a.index, b.index] });
      }
    }
  }
  return flags;
}

export const FLAG_TEXT: Record<CorrelationFlag["kind"], { pt: string; en: string }> = {
  same_team: { pt: "Linhas {a} e {b}: dois jogadores do mesmo time no mesmo jogo andam juntos. Em Criar Aposta a casa desconta essa correlação na odd.", en: "Legs {a} and {b}: two players from the same team in the same game move together. A same-game builder discounts that correlation in the price." },
  same_player: { pt: "Linhas {a} e {b}: o mesmo jogador duas vezes. Se ele render pouco, as duas caem juntas.", en: "Legs {a} and {b}: the same player twice. If he has a quiet night, both break together." },
  fights: { pt: "Linhas {a} e {b} brigam entre si: o favorito vencer costuma vir com gols/pontos dele, e o under pede o contrário.", en: "Legs {a} and {b} pull against each other: the favourite winning usually comes with its own scoring, and the under asks for the opposite." },
};

export const flagText = (f: CorrelationFlag, lang: "pt" | "en") => FLAG_TEXT[f.kind][lang].replace("{a}", String(f.legs[0] + 1)).replace("{b}", String(f.legs[1] + 1));
