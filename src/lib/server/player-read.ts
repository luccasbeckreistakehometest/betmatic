import { z } from "zod";
import { generateStructuredWithUsage } from "@/lib/ai/extract";
import { CHEAP_MODEL } from "@/lib/ai/client";
import { brasiliaDayStart } from "@/lib/server/ai-budget";
import { getDb, nowIso } from "@/lib/server/db";
import { rateTable } from "@/lib/props/rates";
import type { PlayerProfileView } from "@/lib/props/player-view";
import type { Lang } from "@/lib/i18n";

/**
 * "Leitura do analista": a short paragraph grounded only in the numbers the deep dive already shows.
 * Written by the cheap model, once per athlete, day and language, and shared by every later reader.
 */
export interface PlayerRead { text: string; watch: string; generatedAt: string }

const ReadSchema = z.object({
  text: z.string().describe("At most 120 words. What the numbers say about this player's lines today."),
  watch: z.string().describe("One sentence: the single thing that would change the read (role, minutes, matchup)."),
});

const SYSTEM: Record<Lang, string> = {
  pt: `Você é um analista de apostas esportivas escrevendo para apostadores recreativos no Brasil. Escreva no máximo 120 palavras em português do Brasil, com o vocabulário de quem aposta (linha, over/under, minutagem, perna). Use apenas os números fornecidos; não invente estatística, lesão nem notícia. Nunca prometa resultado, nunca fale em lucro, nunca sugira valor de aposta. Amostra pequena é evidência fraca: diga isso quando for o caso. Se o histórico e o preço da casa discordam, aponte a discordância sem afirmar que a casa errou.`,
  en: `You are a sports-betting analyst writing for recreational bettors. Write at most 120 words in plain American English. Use only the numbers provided; never invent a stat, an injury or a news item. Never promise a result, never talk about profit, never suggest a stake. A small sample is weak evidence: say so when it applies. If the game log and the book's price disagree, point out the disagreement without claiming the book is wrong.`,
};

export const readDayKey = (now = new Date()) => brasiliaDayStart(now).slice(0, 10);

export function storedRead(sportKey: string, athleteId: string, lang: Lang, now = new Date()): PlayerRead | null {
  const row = getDb().prepare("SELECT payload FROM player_reads WHERE sportKey=? AND athleteId=? AND dayKey=? AND lang=?").get(sportKey, athleteId, readDayKey(now), lang) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as PlayerRead) : null;
}

const pct = (hits: number, of: number) => (of ? `${hits}/${of} (${Math.round((hits / of) * 100)}%)` : "no sample");

/** The numbers the model is allowed to use, in a compact block. */
export function readPrompt(profile: PlayerProfileView): string {
  const lines: string[] = [
    `PLAYER: ${profile.name} (${profile.teamAbbr}${profile.position ? `, ${profile.position}` : ""})`,
    profile.game ? `GAME: ${profile.game.matchup}, opponent ${profile.game.opponentAbbr}` : "GAME: none selected",
    `GAMES LOGGED: ${profile.games.length}`,
  ];
  if (profile.role) {
    const r = profile.role;
    lines.push(`ROLE: ${r.tier}${r.recentMinutes !== null ? `, ${r.recentMinutes} min recent / ${r.minutesPerGame} avg, trend ${r.minutesTrend}` : ""}; ${r.note}`);
  }
  for (const m of profile.markets) {
    const posted = m.posted.filter((p) => p.side === "over" || p.kind === "total");
    const probe = posted.length ? posted.slice(0, 3) : [{ line: m.defaultLine, side: "over" as const, decimal: NaN, noVigFair: null }];
    if (!posted.length && !["points", "rebounds", "assists", "shots", "shots_on_target", "fouls_committed"].includes(m.key)) continue;
    for (const p of probe) {
      const t = rateTable(profile.games, m.statLabels, p.line, p.side);
      const price = Number.isFinite(p.decimal) ? ` | book ${p.decimal.toFixed(2)}${p.noVigFair !== null ? `, no-vig ${Math.round(p.noVigFair * 100)}%` : ""}` : " | no posted price";
      lines.push(`${m.label.en} ${p.side} ${p.line}: L5 ${pct(t.last5.hits, t.last5.of)}, L10 ${pct(t.last10.hits, t.last10.of)}, season ${pct(t.season.hits, t.season.of)}, home ${pct(t.home.hits, t.home.of)}, away ${pct(t.away.hits, t.away.of)}${price}`);
    }
  }
  if (profile.dvp) {
    const d = profile.dvp;
    lines.push(`DEFENCE VS POSITION (${d.position}, ${d.games} games): ${d.opponent} concedes ${d.opponentConcedes.points} pts, ${d.opponentConcedes.rebounds} reb, ${d.opponentConcedes.assists} ast per game${d.ownConcedes ? `; for reference his own team concedes ${d.ownConcedes.points} pts` : ""}`);
  }
  return lines.join("\n");
}

function mockRead(profile: PlayerProfileView, lang: Lang): { text: string; watch: string } {
  return lang === "pt"
    ? { text: `${profile.name}: ${profile.games.length} jogos no histórico. Leitura de teste gerada sem IA.`, watch: "Fique de olho na minutagem." }
    : { text: `${profile.name}: ${profile.games.length} games logged. Test read generated without AI.`, watch: "Keep an eye on the minutes." };
}

/** Generates and stores the read. Returns the stored row when another request already wrote it. */
export async function writePlayerRead(profile: PlayerProfileView, lang: Lang, paidBy: string | null): Promise<{ read: PlayerRead; costUsd: number }> {
  const { data, costUsd } = await generateStructuredWithUsage({
    schema: ReadSchema,
    system: SYSTEM[lang],
    prompt: `${readPrompt(profile)}\n\nWrite the read in ${lang === "pt" ? "Brazilian Portuguese" : "English"}.`,
    model: CHEAP_MODEL,
    maxTokens: 700,
    label: "player_read",
    mock: () => mockRead(profile, lang),
  });
  const read: PlayerRead = { text: data.text.trim(), watch: data.watch.trim(), generatedAt: nowIso() };
  getDb().prepare("INSERT OR IGNORE INTO player_reads (sportKey, athleteId, dayKey, lang, payload, paidBy, costUsd, createdAt) VALUES (?,?,?,?,?,?,?,?)")
    .run(profile.sportKey, profile.athleteId, readDayKey(), lang, JSON.stringify(read), paidBy, costUsd, read.generatedAt);
  return { read: storedRead(profile.sportKey, profile.athleteId, lang) ?? read, costUsd };
}
