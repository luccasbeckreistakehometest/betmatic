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
  /**
   * O portão que agiu. `cap:<id>` não é um descarte: é um teto medido que baixou o número de uma
   * perna (ver MEASURED_CAPS no fim deste arquivo). Fica no mesmo canal porque quem lê o log de
   * portões quer ver as duas coisas, e a razão já diz qual foi.
   */
  gate: "player_concentration" | "availability" | "cross_shape" | `cap:${string}`;
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

/* ── Tetos medidos ──────────────────────────────────────────────────────────────────────────────
 *
 * O que o laço de aprendizado aprendeu em 21 jogos, escrito como código em vez de como frase.
 *
 * Em 25/09/2026 o laço leu os 14 jogos com bilhete liquidado desde o dia 21 e devolveu 25
 * propostas. TODAS foram classificadas como portão de código, nenhuma como mudança de prompt — e
 * isso não é um acaso desta rodada: em 21 jogos lidos o agente nunca propôs uma frase. Toda lição
 * que ele tira é contagem ou comparação, e o prompt já dizia várias delas sem efeito.
 *
 * Estes tetos são de MÃO ÚNICA: só puxam uma estimativa para baixo, nunca para cima. É uma escolha
 * deliberada. Uma correção que pode subir número precisa estar certa nas duas direções para não
 * fazer mal, e a medição que temos (ledger/recalibrate.ts, 573 decididos) não sustenta isso — mas
 * sustenta com folga que certas fatias prometem muito mais do que entregam.
 *
 * Entram só as fatias com amostra de 100 pernas ou mais e desvio de 10 pontos ou mais. As outras
 * lições do laço continuam na fila do /admin esperando implementação, e é onde devem estar.
 */

/** Pernas mínimas para uma fatia poder impor teto. Abaixo disso é ruído com opinião. */
export const CAP_MIN_LEGS = 100;
/** Pontos mínimos entre prometido e entregue. Abaixo disso não vale mexer no número de ninguém. */
export const CAP_MIN_GAP = 10;

export interface MeasuredCap {
  id: string;
  scope: "pre" | "live" | "both";
  /** O teto imposto à fairProbability da perna. */
  cap: number;
  legs: number;
  claimed: number;
  delivered: number;
  /** Em português, para o log e para quem for auditar depois. */
  why: string;
  applies: (leg: { fairProbability: number; settlement?: { side?: string } | null; sourceBasis?: string }) => boolean;
}

const side = (leg: { settlement?: { side?: string } | null }) => leg.settlement?.side ?? "";

export const MEASURED_CAPS: MeasuredCap[] = [
  {
    id: "pre_zona_morta",
    scope: "pre",
    // O teto É a entrega medida. Uma perna que o modelo lê como 62% e que a história paga a 31% não
    // pode ancorar bilhete nenhum pelo número que ela alega; deixá-la visível com o número honesto é
    // melhor que escondê-la, e o corte de vantagem da lista do dia decide o resto.
    cap: 0.31,
    legs: 106, claimed: 0.62, delivered: 0.31,
    why: "No pré-jogo, as pernas cotadas entre 60% e 70% entregaram 31% contra 62% prometidos em 106 pernas decididas. A faixa logo abaixo (50-60%, 352 pernas) está calibrada em −2 pontos e a de cima também, então é um buraco isolado e não uma inclinação.",
    applies: (leg) => leg.fairProbability >= 0.6 && leg.fairProbability < 0.7,
  },
  {
    id: "live_alta_confianca",
    scope: "live",
    // Uma regra só para toda a região acima de 80%, porque as duas faixas que a compõem erram para o
    // mesmo lado: 80-90% entrega 63% (191 pernas) e 90-100% entrega 81% (338 pernas). O teto de 80%
    // é generoso com a primeira de propósito — teto de mão única não deve tentar acertar na mosca.
    cap: 0.8,
    legs: 529, claimed: 0.9, delivered: 0.75,
    why: "Ao vivo, tudo acima de 80% promete mais do que entrega: a faixa 80-90% entregou 63% em 191 pernas e a de 90-100% entregou 81% em 338. Nada in-play sai acima de 80%.",
    applies: (leg) => leg.fairProbability >= 0.8,
  },
];

/*
 * O que NÃO virou teto, e por quê — para ninguém reabrir a discussão sem medir de novo:
 *
 * · Pré-jogo 80-90%: uma proposta do laço pedia teto de 82% citando 191 pernas a 63%. Aquelas 191
 *   pernas são do AO VIVO; no pré-jogo essa faixa tem 17 pernas e entrega 100%, ou seja, é
 *   SUBconfiante. O teto teria cortado bilhete bom por causa de uma fatia lida do escopo errado.
 * · Pré-jogo 0-40%: erra 11 pontos, mas são 71 pernas — abaixo do piso de 100 desta lista.
 * · Ao vivo 60-70% e 70-80%: erram 1 e 7 pontos. Não há o que corrigir.
 * · Linha de casa cotada em 1,5-2x: 166 pernas, mas o desvio é de 9 pontos — abaixo do piso de 10
 *   desta lista. Foi escrita, o próprio teste de invariante a reprovou, e ficou de fora. Baixar o
 *   piso para ela caber seria escolher o limiar pelo resultado que se quer.
 */

export interface CapApplied {
  id: string;
  from: number;
  to: number;
  why: string;
}

/**
 * Aplica os tetos medidos a uma perna já calibrada, e diz quais pegaram.
 *
 * Roda DEPOIS da calibração de propósito: a calibração corrige a fatia inteira pela média, e estes
 * tetos são sobre o extremo, que é onde a média não chega. Nenhum deles inventa número para cima.
 */
export function applyMeasuredCaps(
  leg: { fairProbability: number; settlement?: { side?: string } | null; sourceBasis?: string },
  scope: "pre" | "live",
  caps: MeasuredCap[] = MEASURED_CAPS,
): { fairProbability: number; applied: CapApplied[] } {
  let p = leg.fairProbability;
  const applied: CapApplied[] = [];
  if (!Number.isFinite(p)) return { fairProbability: p, applied };

  for (const c of caps) {
    if (c.scope !== "both" && c.scope !== scope) continue;
    if (c.legs < CAP_MIN_LEGS || Math.abs(c.claimed - c.delivered) * 100 < CAP_MIN_GAP) continue;
    // O teste de aplicabilidade lê a probabilidade CORRENTE, para um teto já aplicado poder tirar a
    // perna do alcance do seguinte em vez de os dois brigarem pela mesma casa decimal.
    if (!c.applies({ ...leg, fairProbability: p })) continue;
    if (p <= c.cap) continue;
    applied.push({ id: c.id, from: p, to: c.cap, why: c.why });
    p = c.cap;
  }
  return { fairProbability: p, applied };
}
