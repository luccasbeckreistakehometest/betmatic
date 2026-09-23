import { matchCandidate, type LegKey, type EnrichContext } from "@/lib/bets/enrich";
import { normaliseName } from "@/lib/resolve/names";
import { resolveStatLabels } from "@/lib/props/history";
import { getSport } from "@/lib/sports";
import type { BetSuggestion } from "@/lib/types";

/**
 * The gates the prompt used to ask for in prose and nobody checked.
 *
 * The learning run of 23/09/2026 read 323 settled tickets and found the same two rules broken that
 * the system prompt has been stating for weeks. A rule that asks the model to police itself does not
 * hold: it is a preference, not a gate. Everything in this file is the code version of a paragraph
 * that is still in bets/prompt-defaults.ts, because the prose explains WHY to a human reader and the
 * code is what actually decides what gets emitted. Neither replaces the other.
 *
 * Nothing here rewrites a ticket or moves a probability. A ticket that fails a gate is dropped whole,
 * exactly like a ticket with an unpriced leg or an incoherent settlement (bets/builder.ts), and the
 * drop is returned with its reason so the caller can log it.
 */

/** A ticket that did not survive a gate, with the reason, for the ops log. */
export interface GateDrop {
  /** The ticket's own id, so the log line points at something that existed. */
  ticketId: string;
  gate: "player_concentration" | "availability";
  /** One line, in English like the rest of the code, naming what broke. */
  reason: string;
}

/**
 * No player may carry more than this share of the main tickets a build returns.
 *
 * Measured on the 323 settled tickets of 21-23/09/2026: of the 31 builds that returned two tickets
 * or more, 11 broke this cap. The worst were one build of 15 tickets with Isabelle Harrison in 10 of
 * them (10 losses), one of 12 with Aliyah Boston in 7, one of 12 with Michaela Onyenwere and Shakira
 * Austin in 7 each, and one of 11 with Kayla McBride in 7 and Courtney Williams in 6. Counted per
 * line instead of per player the same slates looked fine, which is exactly the hole the prompt
 * already described: Ariel Atkins under 6.5 points rode 14 tickets and lost all 14, Chelsea Gray's
 * PRA under 20.5 rode 9 and lost 9, Carla Leite's assists under 5.5 rode 9 and lost 8.
 */
export const MAX_PLAYER_SHARE = 0.5;

/**
 * Projected minutes below which an over on a volume stat is not emitted before tip-off. The number is
 * the prompt's own ("projected minutes under 20 disqualify any over on a volume stat"), kept here so
 * the two never drift apart.
 */
export const MIN_MINUTES_FOR_VOLUME_OVER = 20;

/** The stats the minutes floor covers: the prompt names points, rebounds, assists and their sums. */
const VOLUME_STATS = new Set(["PTS", "REB", "AST"]);

/**
 * Who a leg is a bet on. `athleteId` is attached in code by enrich.ts when the feed carried the line,
 * so it survives two spellings of one name; the normalised name is the fallback for a leg the feed
 * did not carry. A leg with no player at all (a moneyline, a game total) is nobody's exposure.
 */
export function playerKeysOf(bet: Pick<BetSuggestion, "legs">): string[] {
  const keys = new Set<string>();
  for (const leg of bet.legs) {
    const name = leg.settlement?.player?.trim();
    if (leg.settlement?.type !== "player_prop" || !name) continue;
    keys.add(leg.athleteId ? `id:${leg.athleteId}` : `name:${normaliseName(name)}`);
  }
  return [...keys];
}

/**
 * The by-player cap, imposed on the tickets a build is about to return.
 *
 * Counting is by PLAYER, never by leg: two lines on one player on one night are one bet on one
 * night, and the per-leg count is what let a slate hide its real exposure. A ticket over the cap is
 * DROPPED rather than rewritten — rewriting it would mean inventing a leg nobody evidenced.
 *
 * Only MAIN tickets are counted. An alternative is a substitute for its main ("se a Fulana for
 * vetada"), not a second bet the reader places beside it, so counting it would charge the reader
 * twice for one exposure; an alternative whose main is dropped goes with it, because a plan B with
 * no plan A is just another ticket nobody chose.
 *
 * The order decides who survives, so it is deterministic and it prefers quality over position in the
 * list. Bands take turns — the best ticket of every band is admitted before any band gets a second —
 * because the cap must never be the reason a band disappears from a build. Inside a band the key is
 * evidenceScore (computed in code from the legs, never the model's own "high"), then the modelled
 * probability, then the id, which is a hash of the legs and therefore stable across runs.
 *
 * The denominator is the count the build RETURNS, not the count it proposed, because that is the rule
 * as written and the two are not the same once tickets start being dropped. Dropping shrinks the
 * denominator, so the pass is repeated against the new count until it stops moving; it terminates,
 * since the kept count is monotone non-increasing. On the 322 settled tickets of 21-23/09/2026 the
 * two readings cost 33 tickets against 21, and left 5 of the 31 multi-ticket builds over half instead
 * of 10 — which is why this one won.
 *
 * The cap floors at one, because the rule is unsatisfiable below that: a build whose every ticket
 * rests on one player has no subset where she holds half or less, so the fixed point lands on a
 * single ticket. That is the right answer rather than a defeat — such a build was one idea written
 * out nine times, and one of the five it happened to on 22/09/2026 was nine tickets that all needed
 * Janelle Salaun's night. Bands survive wherever the cap leaves room for them, and stop being a
 * guarantee only in that collapsed case.
 */
export function capPlayerConcentration(bets: BetSuggestion[]): { kept: BetSuggestion[]; dropped: GateDrop[] } {
  const mains = bets.filter((b) => !b.alternativeFor);
  if (mains.length < 2) return { kept: bets, dropped: [] };

  const byBand = new Map<string, BetSuggestion[]>();
  for (const b of [...mains].sort((a, z) => z.evidenceScore - a.evidenceScore || z.modelledProbability - a.modelledProbability || a.id.localeCompare(z.id))) {
    if (!byBand.has(b.bandKey)) byBand.set(b.bandKey, []);
    byBand.get(b.bandKey)!.push(b);
  }
  // Round-robin over the bands, each band in its own quality order.
  const order: BetSuggestion[] = [];
  const queues = [...byBand.values()];
  for (let round = 0; order.length < mains.length; round += 1) {
    for (const q of queues) if (q[round]) order.push(q[round]);
  }

  const admit = (cap: number): { in: BetSuggestion[]; out: BetSuggestion[] } => {
    const seen = new Map<string, number>();
    const passed: BetSuggestion[] = [];
    const over: BetSuggestion[] = [];
    for (const bet of order) {
      const keys = playerKeysOf(bet);
      if (keys.some((k) => (seen.get(k) ?? 0) + 1 > cap)) { over.push(bet); continue; }
      for (const k of keys) seen.set(k, (seen.get(k) ?? 0) + 1);
      passed.push(bet);
    }
    return { in: passed, out: over };
  };

  const capFor = (n: number) => Math.max(1, Math.floor(n * MAX_PLAYER_SHARE));
  let returning = mains.length;
  let pass = admit(capFor(returning));
  // The loop converges in a handful of steps; the bound is a guard, not a schedule.
  for (let i = 0; i < 8 && pass.in.length < returning; i += 1) {
    returning = pass.in.length;
    pass = admit(capFor(returning));
  }
  if (!pass.out.length) return { kept: bets, dropped: [] };

  const cap = capFor(returning);
  const gone = new Set(pass.out.map((b) => b.id));
  const dropped: GateDrop[] = pass.out.map((b) => ({
    ticketId: b.id,
    gate: "player_concentration" as const,
    reason: `a player on this ticket already carries ${cap} of the ${returning} tickets this build returns (cap ${MAX_PLAYER_SHARE})`,
  }));
  const kept: BetSuggestion[] = [];
  for (const bet of bets) {
    if (gone.has(bet.id)) continue;
    if (bet.alternativeFor && gone.has(bet.alternativeFor)) {
      dropped.push({ ticketId: bet.id, gate: "player_concentration", reason: `its main ticket ${bet.alternativeFor} was dropped by the by-player cap` });
      continue;
    }
    kept.push(bet);
  }
  return { kept, dropped };
}

/** Whether a market is one of the volume stats the minutes floor covers. */
function isVolumeStat(stat: string | null, sportKey: string): boolean {
  const labels = resolveStatLabels(stat ?? "", sportKey);
  return !!labels?.length && labels.every((l) => VOLUME_STATS.has(l));
}

/**
 * Whether a set of legs may be emitted before tip-off, given what the code knows about who is
 * playing. Returns the reason to drop the ticket, or null.
 *
 * Three rules, all of them already written in the prompt and none of them checked until now:
 *
 * 1. A player the injury report lists OUT is unplayable, on either side of the line. The listing is
 *    the one carried on the candidate row by props/minutes.ts (`listingAvailability`), so this reads
 *    the same flag the prompt is shown.
 * 2. A player-prop leg the code could not model at all — no candidate row, so no projected minutes,
 *    no fitted rate and no computed probability — is a price with a story attached. On 21-23/09/2026
 *    the 55 settled tickets holding at least one such leg won 20.0% against 46.1% for the 267 whose
 *    every prop leg was modelled, and the gap holds at matched ticket length (2-3 legs: 25.0% of 24
 *    against 43.9% of 114; 4+ legs: 7.4% of 27 against 26.9% of 78). Four of Kayla McBride's six
 *    losing overs that night were legs of exactly this kind, on a player who finished with 0 points,
 *    0 rebounds, 0 assists and 0 threes.
 * 3. Projected minutes under MIN_MINUTES_FOR_VOLUME_OVER disqualify an over on points, rebounds,
 *    assists or their sums — the prompt's own DISQUALIFIED OUTRIGHT line.
 *
 * In play none of this applies and the gate is not called: the live projection reports the minutes
 * that REMAIN, which are under twenty from half-time onward by definition, and it stamps every row
 * "ok" because the injury report has nothing left to say once the ball is up.
 *
 * Only basketball is gated. props/model.ts is the basketball rate model; a football or tennis prop
 * has no candidate row of this shape, and gating it on one would drop every one of those tickets.
 */
export function unplayableReason(legs: LegKey[], ctx: EnrichContext): string | null {
  if (getSport(ctx.sportKey).group !== "basketball") return null;
  for (const leg of legs) {
    if (leg.settlementType !== "player_prop") continue;
    const who = leg.settlementPlayer?.trim() || "unnamed player";
    const prop = matchCandidate(leg, ctx);
    const model = prop?.model ?? null;
    if (!model) return `${who}: no projected minutes for this line — the feed carried no candidate the rate model could price`;
    if (model.minutes.availability === "listed_out") return `${who}: listed OUT on the injury report`;
    const minutes = model.minutes.expected;
    if (!Number.isFinite(minutes)) return `${who}: the minutes projection did not resolve to a number`;
    if (leg.settlementSide === "over" && isVolumeStat(leg.settlementStat, ctx.sportKey) && minutes < MIN_MINUTES_FOR_VOLUME_OVER) {
      return `${who}: ${minutes.toFixed(0)} projected minutes, under the ${MIN_MINUTES_FOR_VOLUME_OVER} an over on a volume stat needs`;
    }
  }
  return null;
}
