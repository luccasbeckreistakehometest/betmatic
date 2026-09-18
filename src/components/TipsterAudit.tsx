"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useNavState } from "@/components/Controls";
import { Panel } from "@/components/ui";
import { TIPSTER_COPY } from "@/components/tipster-copy";
import { TipsterReport } from "@/components/TipsterReport";
import { formatDate } from "@/lib/format";
import { SOLD_SPORTS } from "@/lib/sports";
import type { AuditReport, GradedPick } from "@/lib/tipster/audit";

interface Audit { id: string; label: string; sportKey: string; createdAt: string; report: AuditReport; picks: GradedPick[] }
interface State { audits: Audit[]; allowance: { used: number; limit: number; window: "week" | "month" }; extraPrice: number; coins: number; aiReady: boolean; error?: string }

/** Browser-side shrink to a JPEG under ~600 KB, returned as base64 without the data: prefix. */
async function toBase64Jpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8).split(",")[1] ?? "";
}

export function TipsterAudit() {
  const { lang, sport } = useNavState();
  const c = TIPSTER_COPY[lang];
  const [state, setState] = useState<State | null>(null);
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sportKey, setSportKey] = useState(SOLD_SPORTS.some((s) => s.key === sport.key) ? sport.key : SOLD_SPORTS[0].key);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; pay?: boolean; buy?: boolean } | null>(null);
  const [latest, setLatest] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/tipster", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setState(await r.json());
    else if (r?.status === 401) setState({ audits: [], allowance: { used: 0, limit: 0, window: "month" }, extraPrice: 0, coins: 0, aiReady: false, error: "unauthenticated" });
  }, []);
  useEffect(() => { const id = setTimeout(() => void load(), 0); return () => clearTimeout(id); }, [load]);

  async function run(extra = false) {
    setBusy(true);
    setNote(null);
    try {
      const images = await Promise.all(files.slice(0, 5).map(toBase64Jpeg));
      const r = await fetch("/api/tipster", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang, sport: sportKey, label, text, images, extra }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setLatest(j.id);
        setText("");
        setFiles([]);
        await load();
      } else if (j.error === "tipster_cap") setNote({ text: c.capTitle, pay: true });
      else if (j.error === "insufficient_coins") setNote({ text: c.noCoins, buy: true });
      else {
        setNote({ text: j.message ?? c.aiOff });
        // An empty read still used the period's slot: show the new count.
        if (j.error === "tipster_unreadable") await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/tipster?id=${id}`, { method: "DELETE" });
    await load();
  }

  const a = state?.allowance;
  const field = "w-full rounded-control border border-line-control bg-surface-1 px-2.5 py-1.5 text-sm text-fg";
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-label u-label text-fg-dim">{lang === "pt" ? "Antes de pagar grupo VIP" : "Before you pay for a VIP group"}</p>
        <h1 className="mt-1 text-lead font-semibold tracking-tight text-fg">{c.title}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-muted">{c.sub}</p>
        <p className="mt-2 max-w-2xl text-tiny text-fg-dim" data-testid="tipster-privacy">{c.privacy}</p>
      </div>
      {state?.error ? <p className="text-sm text-fg-muted">{lang === "pt" ? "Entre na sua conta para usar o raio-x." : "Log in to run an audit."}</p> : (
        <Panel title={c.title} lang={lang} meta={a ? c.allowance.replace("{used}", String(a.used)).replace("{limit}", String(a.limit)).replace("{window}", a.window === "week" ? c.week : c.month) : undefined}>
          <div className="flex flex-col gap-3">
            <label className="text-tiny text-fg-muted">{c.label}<input className={field} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} data-testid="tipster-label" /></label>
            <label className="text-tiny text-fg-muted">{c.text}
              <textarea className={`${field} min-h-40`} value={text} maxLength={30_000} onChange={(e) => setText(e.target.value)} placeholder={c.textHint} data-testid="tipster-text" />
            </label>
            <div className="flex flex-wrap items-center gap-3 text-tiny text-fg-muted">
              <label className="flex items-center gap-2">{c.images}<input type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} className="text-label" /></label>
              <label className="flex items-center gap-2">{c.sport}
                <select value={sportKey} onChange={(e) => setSportKey(e.target.value)} className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap border border-line-control text-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-surface-2 active:bg-surface-3 disabled:cursor-not-allowed disabled:border-line disabled:text-fg-faint" data-testid="tipster-sport">
                  {SOLD_SPORTS.map((s) => <option key={s.key} value={s.key}>{s.label[lang]}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void run(false)} disabled={busy || (!text.trim() && !files.length) || state?.aiReady === false} data-testid="tipster-run" className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap bg-action text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover active:bg-action-active disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-faint">
                {busy ? c.running : c.run}
              </button>
              {state?.aiReady === false && <span className="text-tiny text-fg-dim">{c.aiOff}</span>}
            </div>
            {note && (
              <div className="text-tiny text-warn" data-testid="tipster-note">
                {note.text}
                {note.pay && state && <button type="button" onClick={() => void run(true)} className="ml-2 underline" data-testid="tipster-pay">{c.capPay.replace("{n}", String(state.extraPrice))}</button>}
                {note.buy && <Link href={{ pathname: "/planos", query: { lang } }} className="ml-2 underline">{c.buy}</Link>}
              </div>
            )}
          </div>
        </Panel>
      )}
      <Panel title={c.past} lang={lang}>
        {state?.audits.length ? (
          <ul className="flex flex-col gap-4">
            {state.audits.map((x) => (
              <li key={x.id} className={`rounded-control border p-3 ${x.id === latest ? "border-pos" : "border-line"}`} data-testid="tipster-audit">
                <p className="mb-2 text-tiny text-fg-muted"><span className="font-semibold text-fg">{x.label}</span> · {formatDate(x.createdAt, lang, { year: true })}</p>
                <TipsterReport report={x.report} picks={x.picks} lang={lang} onDelete={() => void remove(x.id)} />
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-fg-dim">{c.empty}</p>}
      </Panel>
    </div>
  );
}
