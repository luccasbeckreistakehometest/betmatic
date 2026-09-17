"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SCAN_COPY } from "@/components/scan-copy";
import { checkText, slipChecks } from "@/lib/bets/slip-scan";
import { SOLD_SPORTS } from "@/lib/sports";
import type { Lang } from "@/lib/i18n";

interface DraftLeg { event: string; selection: string; market: string; odds: string; matchup: string | null; auto: boolean }
interface Draft { book: string; betType: "single" | "multiple" | "bet_builder" | null; stake: string; totalOdds: string; potentialReturn: string; legs: DraftLeg[]; unreadable: string[] }
type Phase = "idle" | "reading" | "review" | "saving" | "saved";

export const SLIP_PREFILL_KEY = "bm-slip-prefill";
const num = (s: string) => { const n = Number(s.replace(",", ".")); return Number.isFinite(n) && s.trim() !== "" ? n : null; };
const show = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

/** The browser shrinks the print (max side 1600 px, JPEG) before it leaves the phone. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.8));
}

export function SlipScanner({ lang, sportKey: initialSport, onSaved }: { lang: Lang; sportKey: string; onSaved?: () => void }) {
  const c = SCAN_COPY[lang];
  const [sportKey, setSportKey] = useState(SOLD_SPORTS.some((s) => s.key === initialSport) ? initialSport : SOLD_SPORTS[0].key);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [uses, setUses] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setPhase("reading");
    setNote(null);
    try {
      const body = await shrink(file);
      const r = await fetch(`/api/slip/scan?sport=${sportKey}&lang=${lang}`, { method: "POST", headers: { "content-type": "image/jpeg" }, body });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setPhase("idle");
        setNote(j.manual ? `${j.message ?? ""} ${c.manualFallback}`.trim() : j.message ?? c.manualFallback);
        // An unreadable print still used a slot: keep the counter honest.
        if (j.limit) setUses(c.uses.replace("{used}", String(j.used)).replace("{limit}", String(j.limit)));
        return;
      }
      const s = j.scan;
      setUses(j.limit ? c.uses.replace("{used}", String(j.used)).replace("{limit}", String(j.limit)) : null);
      setDraft({
        book: s.book ?? "", betType: s.betType, stake: show(s.stake), totalOdds: show(s.totalOdds), potentialReturn: show(s.potentialReturn), unreadable: s.unreadable ?? [],
        legs: s.legs.map((l: { event: string; selection: string; market: string; odds: number | null; settlement: unknown; resolved: { matchup: string | null } }) => ({
          event: l.event, selection: l.selection, market: l.market, odds: show(l.odds), matchup: l.resolved?.matchup ?? null, auto: !!l.settlement,
        })),
      });
      setPhase("review");
    } catch {
      setPhase("idle");
      setNote(c.manualFallback);
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  const setLeg = (i: number, patch: Partial<DraftLeg>) => setDraft((d) => (d ? { ...d, legs: d.legs.map((l, k) => (k === i ? { ...l, ...patch } : l)) } : d));
  const checks = draft ? slipChecks({ betType: draft.betType, stake: num(draft.stake), totalOdds: num(draft.totalOdds), potentialReturn: num(draft.potentialReturn), legs: draft.legs.map((l) => ({ odds: num(l.odds) })) }) : [];
  const ready = !!draft && (num(draft.stake) ?? 0) > 0 && (num(draft.totalOdds) ?? 0) > 1 && draft.legs.every((l) => l.selection.trim());

  async function save() {
    if (!draft) return;
    setPhase("saving");
    const r = await fetch("/api/slip/scan/save", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sport: sportKey, lang, book: draft.book || null, betType: draft.betType, stake: num(draft.stake), totalOdds: num(draft.totalOdds), legs: draft.legs.map((l) => ({ event: l.event, selection: l.selection, market: l.market, odds: num(l.odds) })) }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { setPhase("review"); setNote(j.message ?? c.manualFallback); return; }
    setNote(j.limitNotice ? c.limitNotice : null);
    setPhase("saved");
    onSaved?.();
  }

  function analyse() {
    if (!draft) return;
    try { sessionStorage.setItem(SLIP_PREFILL_KEY, JSON.stringify(draft.legs.map((l) => ({ selection: l.selection, market: l.market, odds: l.odds })))); } catch { /* storage may be blocked */ }
    router.push(`/app/slip?sport=${sportKey}&lang=${lang}&from=scan`);
  }

  const field = "w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[12.5px] text-mist-100 outline-none focus:border-edge-400";
  return (
    <section className="rounded-xl border border-edge-400/25 bg-edge-400/[0.04] p-4" data-testid="slip-scanner">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => input.current?.click()} disabled={phase === "reading" || phase === "saving"} data-testid="scan-button"
          className="rounded-lg bg-edge-400 px-3.5 py-1.5 text-[13px] font-semibold text-ink-950 hover:bg-edge-500 disabled:opacity-50">
          {phase === "reading" ? c.reading : c.button}
        </button>
        <input ref={input} type="file" accept="image/*" className="hidden" data-testid="scan-input" onChange={(e) => void onFile(e.target.files?.[0])} />
        <label className="flex items-center gap-1.5 text-[11.5px] text-mist-400">
          {lang === "pt" ? "Campeonato do bilhete" : "League on the slip"}
          <select value={sportKey} onChange={(e) => setSportKey(e.target.value)} className="rounded border border-ink-700 bg-ink-900 px-1.5 py-1 text-[12px] text-mist-100" data-testid="scan-sport">
            {SOLD_SPORTS.map((s) => <option key={s.key} value={s.key}>{s.label[lang]}</option>)}
          </select>
        </label>
        {uses && <span className="nums text-[11px] text-mist-500">{uses}</span>}
      </div>
      {phase === "idle" && <p className="mt-2 text-[12px] leading-relaxed text-mist-400">{c.hint}</p>}
      {note && <p className="mt-2 text-[12px] text-warn-400" data-testid="scan-note">{note}</p>}
      {draft && (phase === "review" || phase === "saving") && (
        <div className="mt-3 flex flex-col gap-3" data-testid="scan-review">
          <div>
            <h3 className="text-[13px] font-semibold text-mist-100">{c.review}</h3>
            <p className="text-[11.5px] text-mist-500">{c.reviewHint}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <label className="text-[10px] uppercase tracking-wider text-mist-500">{c.book}<input className={field} value={draft.book} onChange={(e) => setDraft({ ...draft, book: e.target.value })} /></label>
            <label className="text-[10px] uppercase tracking-wider text-mist-500">{c.type}
              <select className={field} value={draft.betType ?? ""} onChange={(e) => setDraft({ ...draft, betType: (e.target.value || null) as Draft["betType"] })}>
                <option value="">—</option>{Object.entries(c.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="text-[10px] uppercase tracking-wider text-mist-500">{c.stake}<input className={`${field} nums`} inputMode="decimal" value={draft.stake} onChange={(e) => setDraft({ ...draft, stake: e.target.value })} data-testid="scan-stake" /></label>
            <label className="text-[10px] uppercase tracking-wider text-mist-500">{c.total}<input className={`${field} nums`} inputMode="decimal" value={draft.totalOdds} onChange={(e) => setDraft({ ...draft, totalOdds: e.target.value })} data-testid="scan-total" /></label>
            <label className="text-[10px] uppercase tracking-wider text-mist-500">{c.ret}<input className={`${field} nums`} inputMode="decimal" value={draft.potentialReturn} onChange={(e) => setDraft({ ...draft, potentialReturn: e.target.value })} /></label>
          </div>
          <ul className="flex flex-col gap-2">
            {draft.legs.map((l, i) => (
              <li key={i} className="rounded-lg border border-ink-800 bg-ink-900/60 p-2.5" data-testid="scan-leg">
                <div className="grid gap-2 sm:grid-cols-[1.2fr_1.4fr_1fr_80px]">
                  <input className={field} aria-label={`${c.event} ${i + 1}`} value={l.event} onChange={(e) => setLeg(i, { event: e.target.value })} />
                  <input className={field} aria-label={`${c.selection} ${i + 1}`} value={l.selection} onChange={(e) => setLeg(i, { selection: e.target.value })} />
                  <input className={field} aria-label={`${c.market} ${i + 1}`} value={l.market} onChange={(e) => setLeg(i, { market: e.target.value })} />
                  <input className={`${field} nums`} aria-label={`${c.odds} ${i + 1}`} inputMode="decimal" value={l.odds} onChange={(e) => setLeg(i, { odds: e.target.value })} data-testid="scan-leg-odds" />
                </div>
                <p className="mt-1 text-[11px]">
                  {l.auto ? <span className="text-edge-400">{c.found}: {l.matchup} · {c.auto}</span> : <span className="text-mist-500">{c.notFound}</span>}
                </p>
              </li>
            ))}
          </ul>
          {draft.unreadable.length > 0 && <p className="text-[11.5px] text-warn-400">{c.unreadable}: {draft.unreadable.join(", ")}</p>}
          {checks.length > 0 && (
            <ul className="flex flex-col gap-0.5" data-testid="scan-checks">
              {checks.map((k, i) => <li key={i} className={`text-[12px] ${k.ok ? "text-mist-400" : "text-warn-400"}`} data-ok={k.ok}>{k.ok ? "✓" : "!"} {checkText(k, lang)}</li>)}
            </ul>
          )}
          <p className="text-[11px] text-mist-500">{c.privacy}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={!ready || phase === "saving"} data-testid="scan-save" className="rounded-lg bg-edge-400 px-3.5 py-1.5 text-[13px] font-semibold text-ink-950 hover:bg-edge-500 disabled:opacity-40">{phase === "saving" ? c.saving : c.save}</button>
            <button type="button" onClick={analyse} className="rounded-lg border border-ink-700 px-3 py-1.5 text-[12.5px] text-mist-200 hover:border-ink-600" data-testid="scan-analyse">{c.analyse}</button>
            <button type="button" onClick={() => { setDraft(null); setPhase("idle"); }} className="px-2 text-[12px] text-mist-500 hover:text-mist-300">{c.cancel}</button>
          </div>
        </div>
      )}
      {phase === "saved" && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[12.5px]" data-testid="scan-saved">
          <span className="text-edge-400">✓ {c.saved}</span>
          <Link href={{ pathname: "/app/bankroll", query: { lang } }} className="text-mist-300 underline underline-offset-2">{c.seeBankroll}</Link>
          <button type="button" onClick={analyse} className="text-mist-300 underline underline-offset-2">{c.analyse}</button>
        </div>
      )}
    </section>
  );
}
