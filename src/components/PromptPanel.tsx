"use client";

import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/ui";

type Kind = "game" | "slate";
type Lang = "pt" | "en";
interface Active { content: string; version: number; source: string; rationale: string; createdAt: string | null }
interface Version { id: string; kind: Kind; lang: Lang; version: number; source: string; feedback: string; rationale: string; batch: string; createdBy: string; active: number; createdAt: string; chars: number }
interface Payload { active: Record<Kind, Record<Lang, Active>>; history: Record<Kind, Version[]> }

const KIND_LABEL: Record<Kind, string> = { game: "Bilhetes de um jogo", slate: "Múltiplas entre jogos" };
const SOURCE_LABEL: Record<string, string> = { code: "código (v0)", feedback: "feedback", manual: "edição manual", revert: "reversão" };

/**
 * The admin reads the prompt the agent is using, gives feedback in plain words, and the agent
 * rewrites the prompt — both languages at once — explaining what it changed. Every version stays;
 * any of them can be brought back.
 */
export function PromptPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [kind, setKind] = useState<Kind>("game");
  const [lang, setLang] = useState<Lang>("pt");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"feedback" | "manual" | "revert" | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/prompts", { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, []);
  useEffect(() => { const id = setTimeout(() => void load(), 0); return () => clearTimeout(id); }, [load]);

  const active = data?.active[kind][lang];

  async function sendFeedback() {
    setBusy("feedback"); setNote(null);
    try {
      const r = await fetch("/api/admin/prompts/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, feedback }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "falhou");
      setNote({ tone: "ok", text: `Prompt atualizado (pt v${j.versions.find((v: { lang: string }) => v.lang === "pt")?.version}, en v${j.versions.find((v: { lang: string }) => v.lang === "en")?.version}).\n\nO que o agente mudou:\n${j.rationale}` });
      setFeedback(""); await load();
    } catch (e) { setNote({ tone: "err", text: e instanceof Error ? e.message : "falhou" }); }
    finally { setBusy(null); }
  }
  async function saveManual() {
    setBusy("manual"); setNote(null);
    const r = await fetch("/api/admin/prompts/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, lang, content: draft }) });
    const j = await r.json();
    setNote(r.ok ? { tone: "ok", text: `Salvo como v${j.version}.` } : { tone: "err", text: j.error || "falhou" });
    setBusy(null); setEditing(false); await load();
  }
  async function revert(body: { id: string } | { kind: Kind; reset: true }) {
    setBusy("revert"); setNote(null);
    const r = await fetch("/api/admin/prompts/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    setNote(r.ok ? { tone: "ok", text: "Versão restaurada." } : { tone: "err", text: j.error || "falhou" });
    setBusy(null); await load();
  }

  const tab = (on: boolean) => "rounded-control px-2.5 py-1 text-tiny font-medium transition-colors duration-(--dur-1) ease-(--ease-out) " + (on ? "bg-surface-3 text-fg" : "text-fg-dim hover:text-fg-muted");

  return (
    <Panel title="Prompt do agente" meta={active ? `v${active.version} · ${SOURCE_LABEL[active.source] ?? active.source}` : undefined}>
      <div className="flex flex-wrap items-center gap-2" data-testid="prompt-panel">
        {(["game", "slate"] as Kind[]).map((k) => <button key={k} className={tab(kind === k)} onClick={() => { setKind(k); setEditing(false); }}>{KIND_LABEL[k]}</button>)}
        <span className="mx-1 h-4 w-px bg-surface-3" />
        {(["pt", "en"] as Lang[]).map((l) => <button key={l} className={tab(lang === l)} onClick={() => { setLang(l); setEditing(false); }}>{l.toUpperCase()}</button>)}
        <span className="ml-auto text-label text-fg-dim">pt é o idioma de geração; en é derivado dele</span>
      </div>

      {active && !editing && (
        <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-control border border-line bg-surface-0 p-3 font-mono text-tiny leading-relaxed text-fg-muted" data-testid="prompt-content">{active.content}</pre>
      )}
      {editing && (
        <textarea className="mt-3 h-[420px] w-full rounded-control border border-line-strong bg-surface-0 p-3 font-mono text-tiny leading-relaxed text-fg" value={draft} onChange={(e) => setDraft(e.target.value)} />
      )}
      {active?.rationale && !editing && (
        <p className="mt-2 whitespace-pre-wrap rounded-control border border-line bg-surface-1 px-3 py-2 text-tiny text-fg-muted"><span className="font-semibold text-fg-muted">Por que esta versão: </span>{active.rationale}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2 text-tiny">
        {editing ? (
          <>
            <button onClick={saveManual} disabled={busy !== null} className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap bg-action text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover active:bg-action-active disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-faint">Salvar edição</button>
            <button onClick={() => setEditing(false)} className="rounded-control border border-line-strong px-3 py-1.5 text-fg-muted">Cancelar</button>
          </>
        ) : (
          <>
            <button onClick={() => { setDraft(active?.content ?? ""); setEditing(true); }} className="rounded-control border border-line-strong px-3 py-1.5 text-fg-muted hover:border-line-control">Editar à mão</button>
            <button onClick={() => revert({ kind, reset: true })} disabled={busy !== null || active?.version === 0} className="rounded-control border border-line-strong px-3 py-1.5 text-fg-muted hover:border-line-control disabled:bg-surface-3 disabled:text-fg-faint disabled:cursor-not-allowed">Voltar ao original</button>
          </>
        )}
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <p className="text-tiny font-semibold text-fg">Feedback pro agente</p>
        <p className="mt-0.5 text-label text-fg-dim">Diga o que os bilhetes deveriam fazer diferente. O agente reescreve o prompt nos dois idiomas, ativa a versão nova e explica o que mudou. Ex.: “pare de sugerir cartões quando o árbitro não foi confirmado” ou “nas múltiplas, no máximo 4 pernas”.</p>
        <textarea className="mt-2 h-24 w-full rounded-control border border-line-strong bg-surface-0 p-3 text-sm text-fg" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="O que deve mudar na forma como o agente monta os bilhetes?" data-testid="prompt-feedback" />
        <div className="mt-2 flex items-center gap-3">
          <button onClick={sendFeedback} disabled={busy !== null || feedback.trim().length < 10} className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap bg-action text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover active:bg-action-active disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-faint" data-testid="prompt-apply">{busy === "feedback" ? "O agente está reescrevendo…" : "Aplicar feedback"}</button>
          <span className="text-label text-fg-dim">aplica em {KIND_LABEL[kind].toLowerCase()} · pt + en</span>
        </div>
        {note && <p className={"mt-3 whitespace-pre-wrap rounded-control px-3 py-2 text-tiny " + (note.tone === "ok" ? "border border-focus bg-action text-focus" : "border border-warn bg-warn-tint text-warn")} data-testid="prompt-note">{note.text}</p>}
      </div>

      {data && data.history[kind].length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-tiny font-semibold text-fg">Histórico</p>
          <ul className="mt-2 divide-y divide-line text-tiny">
            {data.history[kind].map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="nums w-14 text-fg-muted">v{v.version} {v.lang.toUpperCase()}</span>
                <span className="text-fg-dim">{SOURCE_LABEL[v.source] ?? v.source} · {new Date(v.createdAt).toLocaleString("pt-BR")} · {v.createdBy}</span>
                {v.feedback && <span className="basis-full text-fg-muted">“{v.feedback.slice(0, 160)}{v.feedback.length > 160 ? "…" : ""}”</span>}
                {v.active ? <span className="ml-auto text-focus">ativa</span> : <button onClick={() => revert({ id: v.id })} disabled={busy !== null} className="ml-auto text-fg-muted underline-offset-2 hover:text-fg hover:underline">restaurar</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
