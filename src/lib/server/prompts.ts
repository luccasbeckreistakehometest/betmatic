import { z } from "zod";
import { getDb, newId, nowIso } from "@/lib/server/db";
import { DEFAULT_PROMPTS, type PromptKind } from "@/lib/bets/prompt-defaults";
import { generateStructured } from "@/lib/ai/extract";
import { readLedger } from "@/lib/ledger/store";
import { mainTickets } from "@/lib/ledger/proof";
import type { Lang } from "@/lib/i18n";

export interface PromptVersion {
  id: string; kind: PromptKind; lang: Lang; version: number; content: string; source: string;
  feedback: string; rationale: string; batch: string; createdBy: string; active: number; createdAt: string;
}

/**
 * Stored prompts written before tickets carried linked alternatives still ask for the old
 * `isAlternative` flag, which the schema no longer has. Once per process, such an active version is
 * superseded by a new version (the history stays linear and the admin sees why).
 */
export const ALTERNATIVES_RULE = `- ALWAYS give every main ticket at least TWO alternatives (never more than two). Set alternativeOf on each alternative to the 0-based index of its main ticket in this same suggestions list (main tickets carry alternativeOf null), and write swapReason: the moment to switch, e.g. "se o Fulano for vetado" or "se a linha passar de 2,5". An alternative keeps the same thesis and roughly the same band and changes one or two legs. When a leg depends on one player, at least one alternative must avoid him.`;

export function upgradeAlternativesRule(content: string): string | null {
  if (!/isAlternative/.test(content)) return null;
  const paragraph = /- ALWAYS pair each main ticket[\s\S]*?restating the same bet at a worse price\./;
  return paragraph.test(content)
    ? content.replace(paragraph, ALTERNATIVES_RULE)
    : `${content.replace(/isAlternative/g, "alternativeOf")}\n\n${ALTERNATIVES_RULE}`;
}

let upgraded = false;
function ensurePromptUpgrades(): void {
  if (upgraded) return;
  upgraded = true;
  for (const kind of Object.keys(DEFAULT_PROMPTS) as PromptKind[]) {
    for (const lang of ["pt", "en"] as Lang[]) {
      const row = getDb().prepare("SELECT content FROM prompt_versions WHERE kind=? AND lang=? AND active=1").get(kind, lang) as { content: string } | undefined;
      const next = row ? upgradeAlternativesRule(row.content) : null;
      if (next) savePrompt({ kind, lang, content: next, source: "manual", rationale: "Sistema: bilhetes agora trazem duas alternativas ligadas por alternativeOf (índice do principal) e swapReason; a regra antiga com isAlternative foi substituída.", createdBy: "system" });
    }
  }
}

/** What the builder actually sends: the active stored version, else the code default. */
export function getPrompt(kind: PromptKind, lang: Lang): string {
  ensurePromptUpgrades();
  const row = getDb().prepare("SELECT content FROM prompt_versions WHERE kind=? AND lang=? AND active=1").get(kind, lang) as { content: string } | undefined;
  return row?.content ?? DEFAULT_PROMPTS[kind][lang];
}

/**
 * The same content `getPrompt` returns, plus which version it is — so a ticket can be filed with the
 * prompt that wrote it and a before/after becomes a query instead of an argument. `getPrompt` keeps
 * its signature and its two call sites in the builder; this is beside it, never instead of it.
 */
export function getPromptVersion(kind: PromptKind, lang: Lang): { content: string; version: number; id: string | null } {
  ensurePromptUpgrades();
  const row = getDb().prepare("SELECT id, content, version FROM prompt_versions WHERE kind=? AND lang=? AND active=1").get(kind, lang) as
    | { id: string; content: string; version: number }
    | undefined;
  return row ? { content: row.content, version: row.version, id: row.id } : { content: DEFAULT_PROMPTS[kind][lang], version: 0, id: null };
}

export function listPromptVersions(kind: PromptKind): PromptVersion[] {
  return getDb().prepare("SELECT * FROM prompt_versions WHERE kind=? ORDER BY version DESC, lang").all(kind) as PromptVersion[];
}

export function activePrompts(): Record<PromptKind, Record<Lang, { content: string; version: number; source: string; rationale: string; createdAt: string | null }>> {
  const out = {} as ReturnType<typeof activePrompts>;
  for (const kind of Object.keys(DEFAULT_PROMPTS) as PromptKind[]) {
    out[kind] = {} as (typeof out)[PromptKind];
    for (const lang of ["pt", "en"] as Lang[]) {
      const row = getDb().prepare("SELECT * FROM prompt_versions WHERE kind=? AND lang=? AND active=1").get(kind, lang) as PromptVersion | undefined;
      out[kind][lang] = row
        ? { content: row.content, version: row.version, source: row.source, rationale: row.rationale, createdAt: row.createdAt }
        : { content: DEFAULT_PROMPTS[kind][lang], version: 0, source: "code", rationale: "", createdAt: null };
    }
  }
  return out;
}

function nextVersion(kind: PromptKind, lang: Lang): number {
  const row = getDb().prepare("SELECT MAX(version) v FROM prompt_versions WHERE kind=? AND lang=?").get(kind, lang) as { v: number | null };
  return (row.v ?? 0) + 1;
}

/** Stores a version and makes it the active one for its (kind, lang). */
export function savePrompt(input: { kind: PromptKind; lang: Lang; content: string; source: "feedback" | "manual" | "revert"; feedback?: string; rationale?: string; batch?: string; createdBy: string }): PromptVersion {
  const db = getDb();
  const id = newId("pv");
  db.transaction(() => {
    db.prepare("UPDATE prompt_versions SET active=0 WHERE kind=? AND lang=?").run(input.kind, input.lang);
    db.prepare(`INSERT INTO prompt_versions (id,kind,lang,version,content,source,feedback,rationale,batch,createdBy,active,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`)
      .run(id, input.kind, input.lang, nextVersion(input.kind, input.lang), input.content, input.source, input.feedback ?? "", input.rationale ?? "", input.batch ?? "", input.createdBy, nowIso());
  })();
  return db.prepare("SELECT * FROM prompt_versions WHERE id=?").get(id) as PromptVersion;
}

/** Reverting re-saves the old content as a new version, so the history stays linear and honest. */
export function revertPrompt(id: string, createdBy: string): PromptVersion | null {
  const row = getDb().prepare("SELECT * FROM prompt_versions WHERE id=?").get(id) as PromptVersion | undefined;
  if (!row) return null;
  return savePrompt({ kind: row.kind, lang: row.lang, content: row.content, source: "revert", rationale: `Reversão para a v${row.version}`, createdBy });
}

export function resetToDefault(kind: PromptKind, createdBy: string): void {
  for (const lang of ["pt", "en"] as Lang[]) savePrompt({ kind, lang, content: DEFAULT_PROMPTS[kind][lang], source: "revert", rationale: "Reversão para o prompt original do código (v0)", createdBy });
}

const RewriteSchema = z.object({
  pt: z.string().describe("The full revised Portuguese prompt, complete, ready to use as the system prompt."),
  en: z.string().describe("The full revised English prompt, equivalent to the Portuguese one."),
  rationale: z.string().describe("Em português: o que mudou e por quê, em 3 a 8 linhas, citando trechos alterados. Se algum pedido do feedback foi recusado ou adaptado, diga qual e por quê."),
});
export type Rewrite = z.infer<typeof RewriteSchema>;
export type RewriteFn = (args: { kind: PromptKind; current: { pt: string; en: string }; feedback: string }) => Promise<Rewrite>;

/** The agent reads the admin's feedback and rewrites both languages of the prompt to honour it. */
export const aiRewrite: RewriteFn = async ({ kind, current, feedback }) =>
  generateStructured({
    schema: RewriteSchema,
    maxTokens: 16000,
    system: `You maintain the system prompt of a betting-ticket generator. An admin has given feedback on how the generated tickets should change. Produce the revised prompt.
Rules:
- Apply the feedback precisely and minimally: change what the feedback asks for, keep everything else word for word. Do not shorten, summarise or restyle untouched sections.
- The prompt has hard integrity rules (never invent players, lines or prices; honest probabilities; longer odds mean lower probability). Keep them unless the feedback explicitly asks to change one — and if it does, say so plainly in the rationale.
- If the feedback contradicts itself or would make the output unusable (e.g. asks for prices the inputs never contain), adapt it to the closest workable version and explain in the rationale.
- Keep the Portuguese and English versions equivalent in meaning. The Portuguese one is the primary generation language.
- Return the complete prompts, not diffs.`,
    prompt: `PROMPT KIND: ${kind} (${kind === "game" ? "tickets for one game" : "tickets across several games"})\n\n## CURRENT PROMPT — PT\n${current.pt}\n\n## CURRENT PROMPT — EN\n${current.en}\n\n## ADMIN FEEDBACK\n${feedback}`,
  });

/** Days after which a version is judged by the clock instead of the sample, so this cannot deadlock. */
export const PROMPT_FREEZE_DAYS = 7;
/** Decided main tickets the active version needs before the next one may be written over it. */
export const PROMPT_FREEZE_MIN_DECIDED = 100;

export interface FreezeState {
  frozen: boolean;
  /** The version the freeze is protecting, when there is one. */
  since: string | null;
  version: number;
  decided: number;
  ageDays: number;
  note: string;
}

/**
 * Two rules applied in the same window make both of them uninterpretable: whatever the record does
 * next, nobody can say which change did it. So a new version waits until the one it replaces has
 * either a sample worth reading or a week on the clock — and an admin who wants it anyway says so,
 * and is recorded in `createdBy`.
 */
export function promptFreeze(kind: PromptKind, now = new Date()): FreezeState {
  const row = getDb().prepare("SELECT createdAt, version FROM prompt_versions WHERE kind=? AND active=1 ORDER BY createdAt DESC LIMIT 1").get(kind) as
    | { createdAt: string; version: number }
    | undefined;
  if (!row) return { frozen: false, since: null, version: 0, decided: 0, ageDays: Infinity, note: "" };

  const ageDays = (now.getTime() - Date.parse(row.createdAt)) / 86_400_000;
  const decided = mainTickets(readLedger({ excludeLive: true }))
    .filter((e) => e.createdAt >= row.createdAt && (e.outcome === "won" || e.outcome === "lost")).length;
  const frozen = decided < PROMPT_FREEZE_MIN_DECIDED && ageDays < PROMPT_FREEZE_DAYS;

  return {
    frozen,
    since: row.createdAt,
    version: row.version,
    decided,
    ageDays,
    note: frozen
      ? `A v${row.version} está no ar há ${Math.floor(ageDays)} dia(s) com ${decided} bilhete(s) decidido(s): duas regras aplicadas na mesma janela tornam as duas ininterpretáveis. Ela abre com ${PROMPT_FREEZE_MIN_DECIDED} bilhetes decididos ou ${PROMPT_FREEZE_DAYS} dias.`
      : "",
  };
}

/** Feedback → both languages rewritten and activated in one batch; the rationale is what the admin sees. */
export async function applyFeedback(
  input: { kind: PromptKind; feedback: string; createdBy: string; override?: boolean },
  rewrite: RewriteFn = aiRewrite,
): Promise<{ batch: string; rationale: string; versions: PromptVersion[]; freeze: FreezeState }> {
  const freeze = promptFreeze(input.kind);
  if (freeze.frozen && !input.override) throw new Error(freeze.note);
  const current = { pt: getPrompt(input.kind, "pt"), en: getPrompt(input.kind, "en") };
  const out = await rewrite({ kind: input.kind, current, feedback: input.feedback });
  if (out.pt.trim().length < 200 || out.en.trim().length < 200) throw new Error("O agente devolveu um prompt curto demais; nada foi alterado.");
  const batch = newId("pb");
  // An override is part of the history, not a footnote: whoever skipped the freeze signs the version.
  const createdBy = freeze.frozen ? `${input.createdBy} (override do congelamento)` : input.createdBy;
  const versions = (["pt", "en"] as Lang[]).map((lang) =>
    savePrompt({ kind: input.kind, lang, content: out[lang], source: "feedback", feedback: input.feedback, rationale: out.rationale, batch, createdBy }));
  return { batch, rationale: out.rationale, versions, freeze };
}
