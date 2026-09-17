"use client";

import { useState } from "react";
import { TIPSTER_COPY } from "@/components/tipster-copy";
import { postedLate, RED_FLAGS, shareText, type AuditReport, type GradedPick } from "@/lib/tipster/audit";
import { formatDate } from "@/lib/format";
import type { Lang } from "@/lib/i18n";

const pct = (x: number | null, signed = false) => (x === null ? "—" : `${signed && x > 0 ? "+" : ""}${Math.round(x * 100)}%`);
const TONE: Record<string, string> = { won: "text-edge-400", lost: "text-alert-400", push: "text-mist-400", void: "text-mist-500", pending: "text-mist-500", unverifiable: "text-mist-600" };

/** One audit: aggregate numbers first, then pick by pick. The tipster's label is never in the share text. */
export function TipsterReport({ report, picks, lang, onDelete }: { report: AuditReport; picks: GradedPick[]; lang: Lang; onDelete?: () => void }) {
  const c = TIPSTER_COPY[lang];
  const [copied, setCopied] = useState(false);
  const text = shareText(report, lang);
  const decided = report.won + report.lost;
  async function share() {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  }
  return (
    <div className="flex flex-col gap-3" data-testid="tipster-report">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-ink-800 bg-ink-800 sm:grid-cols-6">
        {[
          [c.total, String(report.total)], [c.verifiable, pct(report.verifiableShare)], [c.hit, pct(report.hitRate)],
          [c.roi, pct(report.roi, true)], [c.run_, String(report.longestLosingRun)], [c.avgOdds, report.averageOdds ? report.averageOdds.toFixed(2).replace(".", lang === "pt" ? "," : ".") : "—"],
        ].map(([k, v]) => (
          <div key={k} className="bg-ink-900 px-3 py-2.5"><div className="text-[9.5px] uppercase tracking-wider text-mist-500">{k}</div><div className="nums text-[17px] font-semibold text-mist-100">{v}</div></div>
        ))}
      </div>
      {decided > 0 && decided < 20 && <p className="text-[11.5px] text-mist-500">{c.smallSample}</p>}
      <ul className="flex flex-col gap-1 text-[12.5px]">
        {report.claimedGreens > 0 && <li className="text-mist-200" data-testid="tipster-claimed">{c.claimed.replace("{c}", String(report.claimedGreens)).replace("{r}", String(report.realGreensAmongClaimed))}</li>}
        {report.postedAfterKickoff > 0 && <li className="font-medium text-alert-400" data-testid="tipster-late">{c.late(report.postedAfterKickoff)}</li>}
        {report.estimatedOdds > 0 && <li className="text-mist-400">{c.estimated(report.estimatedOdds)}</li>}
        {report.total > report.verifiable && <li className="text-mist-400">{c.unverifiable(report.total - report.verifiable)}</li>}
      </ul>
      <div data-testid="tipster-flags">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-mist-500">{c.flags}</h4>
        {report.flags.length ? (
          <ul className="mt-1 flex flex-wrap gap-1.5">{report.flags.map((f) => <li key={f} className="rounded bg-alert-400/12 px-2 py-0.5 text-[11.5px] text-alert-400">{RED_FLAGS.find((r) => r.key === f)?.label[lang] ?? f}</li>)}</ul>
        ) : <p className="mt-1 text-[12px] text-mist-500">{c.noFlags}</p>}
      </div>
      <details className="rounded-lg border border-ink-800 bg-ink-900/50">
        <summary className="cursor-pointer px-3 py-2 text-[12px] text-mist-300">{c.picks} ({picks.length})</summary>
        <ul className="divide-y divide-ink-800 px-3 pb-2">
          {picks.map((p, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-[12px]" data-testid="tipster-pick">
              <span className={`w-24 font-semibold ${TONE[p.outcome]}`}>{c.out[p.outcome]}</span>
              <span className="min-w-0 flex-1 text-mist-200">{p.selection} <span className="text-mist-500">· {p.matchup ?? p.event}</span></span>
              {p.odds && <span className="nums text-mist-400">{p.odds.toFixed(2)}{p.oddsSource === "estimated" ? "*" : ""}</span>}
              {p.postedAt && <span className="text-[11px] text-mist-500">{formatDate(p.postedAt, lang)}</span>}
              {postedLate(p) && <span className="rounded bg-alert-400/12 px-1.5 text-[10.5px] text-alert-400">{c.lateTag}</span>}
            </li>
          ))}
        </ul>
      </details>
      <div className="flex flex-wrap items-center gap-3 text-[12px]">
        <button type="button" onClick={share} className="rounded-lg border border-ink-700 px-3 py-1.5 text-mist-200 hover:border-ink-600" data-testid="tipster-share">{c.share}</button>
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="text-mist-400 underline underline-offset-2 hover:text-mist-100" data-testid="tipster-share-wa">WhatsApp</a>
        {copied && <span className="text-edge-400">{c.copied}</span>}
        <span className="hidden" data-testid="tipster-share-text">{text}</span>
        {onDelete && <button type="button" onClick={onDelete} className="ml-auto text-mist-500 hover:text-alert-400" data-testid="tipster-delete">{c.del}</button>}
      </div>
    </div>
  );
}
