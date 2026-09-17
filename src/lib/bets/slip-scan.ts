import { z } from "zod";
import { resolveTypedLeg, type GameContext, type ResolvedLeg } from "@/lib/bets/deep-slip";
import { mentionsDraw, mentionsWin, normaliseName, parseLine, teamMention } from "@/lib/resolve/names";
import type { Settlement } from "@/lib/types";

/**
 * "Manda o print": what the cheap vision model reads off a slip screenshot, and the deterministic
 * checks shown next to it. Client-safe (the review screen re-runs the checks as the user edits).
 */
export const ScanSchema = z.object({
  book: z.string().nullable().describe("The sportsbook name as printed, or null."),
  betType: z.enum(["single", "multiple", "bet_builder"]).nullable().describe("single = one selection; multiple = múltipla/acumulada; bet_builder = Criar Aposta / same-game builder."),
  stake: z.number().nullable().describe("Amount staked, as a number."),
  totalOdds: z.number().nullable().describe("The slip's total decimal odds."),
  potentialReturn: z.number().nullable().describe("Potential return including the stake, as printed."),
  currency: z.string().nullable(),
  legs: z.array(z.object({
    event: z.string().describe("The match as printed, e.g. 'Flamengo x Palmeiras'."),
    selection: z.string().describe("The pick, e.g. 'Flamengo vence', 'Mais de 2.5', 'Pedro 1+ gols'."),
    market: z.string().describe("The market name as printed."),
    odds: z.number().nullable().describe("Decimal odds of this leg, or null when not printed (bet builder legs)."),
    startsAt: z.string().nullable().describe("Kickoff date/time as printed, or null."),
  })).max(20),
  unreadable: z.array(z.string()).describe("Fields that could not be read."),
});
export type SlipScan = z.infer<typeof ScanSchema>;

export interface ScanLeg { event: string; selection: string; market: string; odds: number | null; startsAt: string | null }

export interface SlipCheck { kind: "product" | "builder_discount" | "return" | "single"; ok: boolean; expected: number; printed: number }

const close = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b), 1e-9);

export function slipChecks(s: { betType: SlipScan["betType"]; stake: number | null; totalOdds: number | null; potentialReturn: number | null; legs: Pick<ScanLeg, "odds">[] }): SlipCheck[] {
  const out: SlipCheck[] = [];
  const odds = s.legs.map((l) => l.odds).filter((o): o is number => o !== null && Number.isFinite(o) && o > 1);
  const product = odds.length === s.legs.length && odds.length ? odds.reduce((a, b) => a * b, 1) : null;
  if (s.totalOdds && product !== null) {
    if (s.betType === "bet_builder") {
      // A builder prices correlated legs together: the ticket pays less than the product, by design.
      if (product > s.totalOdds * 1.02) out.push({ kind: "builder_discount", ok: true, expected: product, printed: s.totalOdds });
    } else if (s.legs.length === 1) {
      out.push({ kind: "single", ok: close(product, s.totalOdds, 0.01), expected: product, printed: s.totalOdds });
    } else {
      out.push({ kind: "product", ok: close(product, s.totalOdds, 0.02), expected: product, printed: s.totalOdds });
    }
  }
  if (s.stake && s.totalOdds && s.potentialReturn) {
    out.push({ kind: "return", ok: close(s.stake * s.totalOdds, s.potentialReturn, 0.01), expected: s.stake * s.totalOdds, printed: s.potentialReturn });
  }
  return out;
}

const n2 = (n: number, lang: "pt" | "en") => (lang === "pt" ? n.toFixed(2).replace(".", ",") : n.toFixed(2));

export function checkText(c: SlipCheck, lang: "pt" | "en"): string {
  const e = n2(c.expected, lang);
  const p = n2(c.printed, lang);
  if (c.kind === "builder_discount") {
    return lang === "pt" ? `Criar Aposta: a casa descontou a correlação (produto ${e}, cupom ${p}).` : `Bet builder: the book discounted the correlation (product ${e}, slip ${p}).`;
  }
  if (c.kind === "return") {
    return c.ok
      ? (lang === "pt" ? `Retorno confere: valor × odd = ${e}.` : `Return checks out: stake × odds = ${e}.`)
      : (lang === "pt" ? `O retorno impresso (${p}) não bate com valor × odd (${e}). Confira o valor ou a odd.` : `The printed return (${p}) doesn't match stake × odds (${e}). Check the stake or the odds.`);
  }
  return c.ok
    ? (lang === "pt" ? `Odds conferem: produto das pernas ${e}.` : `Odds check out: the legs multiply to ${e}.`)
    : (lang === "pt" ? `O produto das odds das pernas (${e}) não bate com a odd total (${p}). Alguma odd pode ter sido lida errado.` : `The legs multiply to ${e}, not the total ${p}. One of the odds may have been misread.`);
}

/** The grading descriptor for a leg the resolver placed; null when it cannot be graded automatically. */
export function settlementFor(r: ResolvedLeg, homeAbbr: string | null): Settlement | null {
  if (r.kind === "player" && r.player && r.marketKey && r.line !== null && r.side) {
    return { type: "player_prop", player: r.player, stat: r.marketKey, line: r.line, side: r.side, sourceBasis: "slip scan" };
  }
  if (r.kind === "moneyline" && r.team) {
    return { type: "moneyline", teamAbbreviation: r.team, side: homeAbbr ? (r.team === homeAbbr ? "home" : "away") : undefined, sourceBasis: "slip scan" };
  }
  // The grader settles game totals only; a team total stays with the user.
  if (r.kind === "total" && !r.team && r.line !== null && r.side) {
    return { type: "total", line: r.line, side: r.side, sourceBasis: "slip scan" };
  }
  return null;
}

/** JPEG, PNG or WebP by their first bytes; anything else is refused before it reaches the model. */
export function sniffImage(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** The game a printed event names: both teams mentioned beats one, a longer name beats a shorter one. */
export function gameForEvent(event: string, games: GameContext[]): GameContext | null {
  const scored = games
    .map((g) => ({ g, home: teamMention(event, g.home), away: teamMention(event, g.away) }))
    .filter((s) => s.home || s.away)
    .sort((a, b) => (Number(b.home > 0) + Number(b.away > 0)) - (Number(a.home > 0) + Number(a.away > 0)) || (b.home + b.away) - (a.home + a.away));
  return scored[0]?.g ?? null;
}

const GAME_TOTAL = /\b(gols|goals|pontos|points|total)\b/;

/**
 * Words that take a leg out of "full-time result" or "full-game total": a period, an either/or pick,
 * a handicap. The grader only settles those two plain markets, so these stay manual (or unverifiable
 * in a tipster audit) instead of being graded as something they are not. Matched on normaliseName text.
 */
const PERIOD = /\b(1|2|primeiro|segundo)\s*o?\s*tempo\b|\b[12]\s*t\b|\bintervalo\b|\bhalf\b|\bht\b|\bquartos?\b|\bquarters?\b|\b[1-4]\s*q\b|\bperiodos?\b|\bperiods?\b|\binnings?\b|\bsets?\b/;
const EITHER = /\bou\b|\bor\b|\bdupla\b|double chance/;
const NOT_RESULT = new RegExp([
  "empate anula", "draw no bet", "\\bdnb\\b", "handicap", "\\bspread\\b", "(^|\\s)[+-]\\s?\\d", "\\bambas\\b", "\\bbtts\\b", "both teams",
  "placar", "correct score", "resultado correto", "classifica", "qualify", "avanca", "\\badvance", "\\bmetodo\\b", "\\bmargem\\b", "\\bmargin\\b",
  "sem sofrer", "clean sheet", "to nil", "escanteio", "\\bcorners?\\b", "\\bcart(ao|oes)\\b", "\\bcards?\\b", "\\bfaltas?\\b", "\\bfouls?\\b",
  "\\bchutes?\\b", "finaliza", "\\bshots?\\b", "impedimento", "offside", "primeiro gol", "first goal", "\\bmarcam?\\b", "\\bscore\\b",
  "rebote", "rebound", "assist", "\\btriplos?\\b", "three", "\\bpar\\b", "\\bimpar\\b", "\\bgames?\\b", "\\bodd\\b", "\\beven\\b",
].join("|"));
/** A market or selection that clearly names the match result (1X2 / moneyline). */
const MATCH_RESULT = /resultado (final|da partida|do jogo)|\bresultado\b|\b1x2\b|vencedor|moneyline|money line|\bml\b|match result|full time result|match winner|\bwinner\b|\bto win\b|para vencer|\bvencer?\b|\bvitoria\b|\bganha\b|\bwins?\b/;

/**
 * The resolver's guess only stands when the grader can settle it truthfully: no period or either/or
 * pick on any leg, whole or half lines only (quarter lines settle half-won), and a team leg must be
 * the plain match result or the full-game total. Everything else becomes unknown, never guessed.
 */
function gradeableOrUnknown(r: ResolvedLeg, leg: ScanLeg): ResolvedLeg {
  if (r.kind === "unknown") return r;
  const text = normaliseName(`${leg.selection} ${leg.market}`).replace(/(\d),(\d)/g, "$1.$2");
  const unknown: ResolvedLeg = { ...r, kind: "unknown", athleteId: null, player: null, team: null, marketKey: null, line: null, side: null };
  if (PERIOD.test(text) || EITHER.test(text)) return unknown;
  if (r.line !== null && !Number.isInteger(r.line * 2)) return unknown;
  if (r.kind === "player") return r;
  if (NOT_RESULT.test(text)) return unknown;
  if (r.kind === "moneyline" && normaliseName(leg.market) && !MATCH_RESULT.test(text)) return unknown;
  return r;
}

/**
 * A printed leg placed on a game: the event line picks the game, then the pick is read within it
 * (a player, a team to win, or the game total). Anything uncertain stays unknown and manual.
 */
export function resolveScanLeg(leg: ScanLeg, index: number, games: GameContext[]): ResolvedLeg {
  return gradeableOrUnknown(placeScanLeg(leg, index, games), leg);
}

function placeScanLeg(leg: ScanLeg, index: number, games: GameContext[]): ResolvedLeg {
  const game = gameForEvent(leg.event, games);
  if (!game) return resolveTypedLeg({ selection: `${leg.selection} ${leg.event}`, market: leg.market, odds: "" }, index, games);
  const within = resolveTypedLeg({ selection: leg.selection, market: leg.market, odds: "" }, index, [game]);
  if (within.kind === "player") return within;
  const text = `${leg.selection} ${leg.market}`;
  const line = parseLine(leg.selection) ?? parseLine(text);
  const base = { ...within, gameId: game.id, matchup: `${game.away.displayName} @ ${game.home.displayName}`, via: "text" as const };
  const home = teamMention(leg.selection, game.home);
  const away = teamMention(leg.selection, game.away);
  if (line && !home && !away && GAME_TOTAL.test(normaliseName(text))) return { ...base, kind: "total", team: null, line: line.line, side: line.side };
  if (mentionsDraw(text) && !home && !away) return { ...base, kind: "draw", team: null };
  if ((home || away) && !line && (mentionsWin(text) || home !== away)) return { ...base, kind: "moneyline", team: home >= away ? game.home.abbreviation : game.away.abbreviation };
  return within;
}
