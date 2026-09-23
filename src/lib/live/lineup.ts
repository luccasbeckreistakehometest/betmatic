import { normaliseName } from "@/lib/resolve/names";
import type { Settlement } from "@/lib/types";

/**
 * Vigia de escalação, the pure half: what the published lineup and the injury report say about each
 * pending leg. No network, no clock — the job feeds it ESPN's summary.
 */
export type LegAlertKind = "bench" | "out" | "doubt" | "key_absence";

export interface LineupSnapshot {
  /** Soccer: the starting elevens are out. Basketball has no published lineup here. */
  published: boolean;
  /** Normalised name → whether the player starts (soccer, when published). */
  squad: Map<string, { starter: boolean; team: string }>;
  /** Normalised name → injury status as ESPN prints it ("Out", "Doubtful"…). */
  injuries: Map<string, string>;
  /** The top players of each team (ESPN's leaders), by team abbreviation. */
  leaders: Map<string, string[]>;
}

export interface WatchedLeg {
  /** Ledger id, or `bl:<entryId>` for a bankroll leg built here or read from a print. */
  ledgerId: string;
  legIndex: number;
  suggestionId?: string;
  selection: string;
  settlement?: Settlement;
}

export interface LegAlert { ledgerId: string; legIndex: number; suggestionId?: string; kind: LegAlertKind; player: string; detail: string }

// ESPN's summary JSON is undocumented; accesses are optional-chained.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

export function lineupSnapshot(summary: Json, injuries: { player: string; status: string }[], leaders: { teamAbbreviation: string; player: string }[]): LineupSnapshot {
  const squad = new Map<string, { starter: boolean; team: string }>();
  for (const side of (summary?.rosters ?? []) as Json[]) {
    const team = String(side.team?.abbreviation ?? "");
    for (const p of (side.roster ?? []) as Json[]) {
      const name = String(p.athlete?.displayName ?? "");
      if (name) squad.set(normaliseName(name), { starter: p.starter === true, team });
    }
  }
  const byTeam = new Map<string, string[]>();
  for (const l of leaders) {
    const list = byTeam.get(l.teamAbbreviation) ?? [];
    if (l.player && !list.includes(l.player) && list.length < 3) list.push(l.player);
    byTeam.set(l.teamAbbreviation, list);
  }
  return {
    published: [...squad.values()].some((p) => p.starter),
    squad,
    injuries: new Map(injuries.map((i) => [normaliseName(i.player), i.status])),
    leaders: byTeam,
  };
}

function injuryKind(status: string | undefined): "out" | "doubt" | null {
  const s = (status ?? "").toLowerCase();
  if (/\bout\b|suspen|injured reserve/.test(s)) return "out";
  if (/doubtful/.test(s)) return "doubt";
  return null;
}

/** Why a player might not play: benched or left out of a published squad, or an injury status. */
function playerRisk(name: string, snap: LineupSnapshot): { kind: "bench" | "out" | "doubt"; detail: string } | null {
  const key = normaliseName(name);
  const injured = injuryKind(snap.injuries.get(key));
  if (injured === "out") return { kind: "out", detail: snap.injuries.get(key)! };
  if (snap.published) {
    const entry = snap.squad.get(key);
    if (!entry) return { kind: "out", detail: "not in the matchday squad" };
    if (!entry.starter) return { kind: "bench", detail: "on the bench" };
    return null;
  }
  if (injured === "doubt") return { kind: "doubt", detail: snap.injuries.get(key)! };
  return null;
}

export function diffLineup(legs: WatchedLeg[], snap: LineupSnapshot): LegAlert[] {
  const out: LegAlert[] = [];
  for (const leg of legs) {
    const s = leg.settlement;
    if (!s) continue;
    const base = { ledgerId: leg.ledgerId, legIndex: leg.legIndex, suggestionId: leg.suggestionId };
    if (s.type === "player_prop" && s.player) {
      const risk = playerRisk(s.player, snap);
      if (risk) out.push({ ...base, kind: risk.kind, player: s.player, detail: risk.detail });
      continue;
    }
    if ((s.type === "moneyline" || s.type === "spread" || s.type === "total") && s.teamAbbreviation) {
      for (const leader of snap.leaders.get(s.teamAbbreviation) ?? []) {
        const risk = playerRisk(leader, snap);
        // A doubt is not an absence yet; the leg is flagged once the player is out or benched.
        if (risk && risk.kind !== "doubt") {
          out.push({ ...base, kind: "key_absence", player: leader, detail: risk.detail });
          break;
        }
      }
    }
  }
  return out;
}

/** The informational line a saver reads. Never "aposte agora": it states what changed. */
export function lineupAlertText(a: Pick<LegAlert, "kind" | "player">, selection: string, matchup: string, lang: "pt" | "en"): { title: string; body: string } {
  const pt: Record<LegAlertKind, string> = {
    bench: `${a.player} começa no banco.`,
    out: `${a.player} está fora do jogo.`,
    doubt: `${a.player} virou dúvida para o jogo.`,
    key_absence: `${a.player} não joga.`,
  };
  const en: Record<LegAlertKind, string> = {
    bench: `${a.player} starts on the bench.`,
    out: `${a.player} is out of the game.`,
    doubt: `${a.player} is now doubtful.`,
    key_absence: `${a.player} is not playing.`,
  };
  return lang === "pt"
    ? { title: `Escalação — ${matchup}`, body: `${pt[a.kind]} A linha "${selection}" perdeu a base. Se quiser, confira a alternativa sem ele na página do jogo.` }
    : { title: `Lineup — ${matchup}`, body: `${en[a.kind]} The leg "${selection}" lost its footing. The backup without him is on the game page if you want it.` };
}

/** For a follower whose plan does not show the affected ticket: the lineup moved, no player, no pick. */
export function lineupNoticeText(matchup: string, lang: "pt" | "en"): { title: string; body: string } {
  return lang === "pt"
    ? { title: `Escalação — ${matchup}`, body: `A escalação de ${matchup} mudou e mexe em bilhetes do jogo. Os detalhes que o seu plano mostra estão na página do jogo.` }
    : { title: `Lineup — ${matchup}`, body: `The ${matchup} lineup changed and it touches tickets on this game. The details your plan shows are on the game page.` };
}
