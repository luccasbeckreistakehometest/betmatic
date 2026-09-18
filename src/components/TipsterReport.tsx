"use client";

import { track } from "@/lib/track";
import { useState } from "react";
import { TIPSTER_COPY } from "@/components/tipster-copy";
import { postedLate, RED_FLAGS, shareText, type AuditReport, type GradedPick } from "@/lib/tipster/audit";
import { formatDate } from "@/lib/format";
import type { Lang } from "@/lib/i18n";

const pct = (x: number | null, signed = false) => (x === null ? "—" : `${signed && x > 0 ? "+" : ""}${Math.round(x * 100)}%`);
const TONE: Record<string, string> = { won: "text-pos", lost: "text-neg", push: "text-fg-muted", void: "text-fg-dim", pending: "text-fg-dim", unverifiable: "text-fg-faint" };

/** One audit: aggregate numbers first, then pick by pick. The tipster's label is never in the share text. */
export function TipsterReport({ report, picks, lang, onDelete }: { report: AuditReport; picks: GradedPick[]; lang: Lang; onDelete?: () => void }) {
  const c = TIPSTER_COPY[lang];
  const [copied, setCopied] = useState(false);
  const text = shareText(report, lang);
  const decided = report.won + report.lost;
  async function share() {
    track("share_clicked", { what: "tipster_audit" });
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  }
  return (
    <div className="flex flex-col gap-3" data-testid="tipster-report">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-control border border-line bg-surface-3 sm:grid-cols-6">
        {[
          [c.total, String(report.total)], [c.verifiable, pct(report.verifiableShare)], [c.hit, pct(report.hitRate)],
          [c.roi, pct(report.roi, true)], [c.run_, String(report.longestLosingRun)], [c.avgOdds, report.averageOdds ? report.averageOdds.toFixed(2).replace(".", lang === "pt" ? "," : ".") : "—"],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface-1 px-3 py-2.5"><div className="text-micro uppercase tracking-wider text-fg-dim">{k}</div><div className="nums text-lead font-semibold text-fg">{v}</div></div>
        ))}
      </div>
      {decided > 0 && decided < 20 && <p className="text-tiny text-fg-dim">{c.smallSample}</p>}
      <ul className="flex flex-col gap-1 text-tiny">
        {report.claimedGreens > 0 && <li className="text-fg" data-testid="tipster-claimed">{c.claimed.replace("{c}", String(report.claimedGreens)).replace("{r}", String(report.realGreensAmongClaimed))}</li>}
        {report.postedAfterKickoff > 0 && <li className="font-medium text-neg" data-testid="tipster-late">{c.late(report.postedAfterKickoff)}</li>}
        {report.estimatedOdds > 0 && <li className="text-fg-muted">{c.estimated(report.estimatedOdds)}</li>}
        {report.total > report.verifiable && <li className="text-fg-muted">{c.unverifiable(report.total - report.verifiable)}</li>}
      </ul>
      <div data-testid="tipster-flags">
        <h4 className="text-micro font-semibold uppercase tracking-wider text-fg-dim">{c.flags}</h4>
        {report.flags.length ? (
          <ul className="mt-1 flex flex-wrap gap-1.5">{report.flags.map((f) => <li key={f} className="rounded-control bg-neg-tint px-2 py-0.5 text-tiny text-neg">{RED_FLAGS.find((r) => r.key === f)?.label[lang] ?? f}</li>)}</ul>
        ) : <p className="mt-1 text-tiny text-fg-dim">{c.noFlags}</p>}
      </div>
      <details className="rounded-control border border-line bg-surface-1">
        <summary className="cursor-pointer px-3 py-2 text-tiny text-fg-muted">{c.picks} ({picks.length})</summary>
        <ul className="divide-y divide-line px-3 pb-2">
          {picks.map((p, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-tiny" data-testid="tipster-pick">
              <span className={`w-24 font-semibold ${TONE[p.outcome]}`}>{c.out[p.outcome]}</span>
              <span className="min-w-0 flex-1 text-fg">{p.selection} <span className="text-fg-dim">· {p.matchup ?? p.event}</span></span>
              {p.odds && <span className="nums text-fg-muted">{p.odds.toFixed(2)}{p.oddsSource === "estimated" ? "*" : ""}</span>}
              {p.postedAt && <span className="text-label text-fg-dim">{formatDate(p.postedAt, lang)}</span>}
              {postedLate(p) && <span className="rounded-control bg-neg-tint px-1.5 text-micro text-neg">{c.lateTag}</span>}
            </li>
          ))}
        </ul>
      </details>
      <div className="flex flex-wrap items-center gap-3 text-tiny">
        <button type="button" onClick={share} className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap border border-line-control text-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-surface-2 active:bg-surface-3 disabled:cursor-not-allowed disabled:border-line disabled:text-fg-faint" data-testid="tipster-share">{c.share}</button>
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="text-fg-muted underline underline-offset-2 hover:text-fg" data-testid="tipster-share-wa">WhatsApp</a>
        {copied && <span className="text-pos">{c.copied}</span>}
        <span className="hidden" data-testid="tipster-share-text">{text}</span>
        {onDelete && <button type="button" onClick={onDelete} className="ml-auto text-fg-dim hover:text-neg" data-testid="tipster-delete">{c.del}</button>}
      </div>
    </div>
  );
}
