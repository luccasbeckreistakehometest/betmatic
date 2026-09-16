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

  const tab = (on: boolean) => "rounded-md px-2.5 py-1 text-[12px] font-medium transition " + (on ? "bg-ink-700 text-mist-100" : "text-mist-500 hover:text-mist-300");

  return (
    <Panel title="Prompt do agente" meta={active ? `v${active.version} · ${SOURCE_LABEL[active.source] ?? active.source}` : undefined}>
      <div className="flex flex-wrap items-center gap-2" data-testid="prompt-panel">
        {(["game", "slate"] as Kind[]).map((k) => <button key={k} className={tab(kind === k)} onClick={() => { setKind(k); setEditing(false); }}>{KIND_LABEL[k]}</button>)}
        <span className="mx-1 h-4 w-px bg-ink-700" />
        {(["pt", "en"] as Lang[]).map((l) => <button key={l} className={tab(lang === l)} onClick={() => { setLang(l); setEditing(false); }}>{l.toUpperCase()}</button>)}
        <span className="ml-auto text-[11px] text-mist-500">pt é o idioma de geração; en é derivado dele</span>
      </div>

      {active && !editing && (
        <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg border border-ink-800 bg-ink-950 p-3 font-mono text-[11.5px] leading-relaxed text-mist-300" data-testid="prompt-content">{active.content}</pre>
      )}
      {editing && (
        <textarea className="mt-3 h-[420px] w-full rounded-lg border border-ink-700 bg-ink-950 p-3 font-mono text-[11.5px] leading-relaxed text-mist-100 outline-none focus:border-edge-400" value={draft} onChange={(e) => setDraft(e.target.value)} />
      )}
      {active?.rationale && !editing && (
        <p className="mt-2 whitespace-pre-wrap rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-[12px] text-mist-400"><span className="font-semibold text-mist-300">Por que esta versão: </span>{active.rationale}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
        {editing ? (
          <>
            <button onClick={saveManual} disabled={busy !== null} className="rounded-md bg-edge-400 px-3 py-1.5 font-semibold text-ink-950 hover:bg-edge-500 disabled:opacity-50">Salvar edição</button>
            <button onClick={() => setEditing(false)} className="rounded-md border border-ink-700 px-3 py-1.5 text-mist-300">Cancelar</button>
          </>
        ) : (
          <>
            <button onClick={() => { setDraft(active?.content ?? ""); setEditing(true); }} className="rounded-md border border-ink-700 px-3 py-1.5 text-mist-300 hover:border-ink-600">Editar à mão</button>
            <button onClick={() => revert({ kind, reset: true })} disabled={busy !== null || active?.version === 0} className="rounded-md border border-ink-700 px-3 py-1.5 text-mist-300 hover:border-ink-600 disabled:opacity-40">Voltar ao original</button>
          </>
        )}
      </div>

      <div className="mt-5 border-t border-ink-800 pt-4">
        <p className="text-[12px] font-semibold text-mist-200">Feedback pro agente</p>
        <p className="mt-0.5 text-[11px] text-mist-500">Diga o que os bilhetes deveriam fazer diferente. O agente reescreve o prompt nos dois idiomas, ativa a versão nova e explica o que mudou. Ex.: “pare de sugerir cartões quando o árbitro não foi confirmado” ou “nas múltiplas, no máximo 4 pernas”.</p>
        <textarea className="mt-2 h-24 w-full rounded-lg border border-ink-700 bg-ink-950 p-3 text-[13px] text-mist-100 outline-none focus:border-edge-400" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="O que deve mudar na forma como o agente monta os bilhetes?" data-testid="prompt-feedback" />
        <div className="mt-2 flex items-center gap-3">
          <button onClick={sendFeedback} disabled={busy !== null || feedback.trim().length < 10} className="rounded-md bg-edge-400 px-3.5 py-1.5 text-[13px] font-semibold text-ink-950 hover:bg-edge-500 disabled:opacity-50" data-testid="prompt-apply">{busy === "feedback" ? "O agente está reescrevendo…" : "Aplicar feedback"}</button>
          <span className="text-[11px] text-mist-500">aplica em {KIND_LABEL[kind].toLowerCase()} · pt + en</span>
        </div>
        {note && <p className={"mt-3 whitespace-pre-wrap rounded-lg px-3 py-2 text-[12px] " + (note.tone === "ok" ? "border border-signal-400/25 bg-signal-400/5 text-signal-400" : "border border-warn-400/25 bg-warn-400/5 text-warn-400")} data-testid="prompt-note">{note.text}</p>}
      </div>

      {data && data.history[kind].length > 0 && (
        <div className="mt-5 border-t border-ink-800 pt-4">
          <p className="text-[12px] font-semibold text-mist-200">Histórico</p>
          <ul className="mt-2 divide-y divide-ink-800 text-[12px]">
            {data.history[kind].map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="nums w-14 text-mist-300">v{v.version} {v.lang.toUpperCase()}</span>
                <span className="text-mist-500">{SOURCE_LABEL[v.source] ?? v.source} · {new Date(v.createdAt).toLocaleString("pt-BR")} · {v.createdBy}</span>
                {v.feedback && <span className="basis-full text-mist-400">“{v.feedback.slice(0, 160)}{v.feedback.length > 160 ? "…" : ""}”</span>}
                {v.active ? <span className="ml-auto text-signal-400">ativa</span> : <button onClick={() => revert({ id: v.id })} disabled={busy !== null} className="ml-auto text-mist-400 underline-offset-2 hover:text-mist-100 hover:underline">restaurar</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
