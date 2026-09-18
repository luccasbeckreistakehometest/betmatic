"use client";

import { useState } from "react";
import { formatDate } from "@/lib/format";
import { makeT, type Lang } from "@/lib/i18n";

interface Review { assumed: string; happened: string; verdict: "variance" | "repeatable_error" | "mixed"; reasoning: string; keyLeg: string | null; watchNext: string[] }
interface Payload { available: boolean; cached: boolean; review: Review | null; createdAt: string | null; legs: string[]; error?: string; message?: string }

/**
 * One click on a lost ticket: what the model assumed, what happened, variance or a repeatable
 * error, and what to check next time. Without a model key the settled legs alone are shown.
 */
export function LossReview({ slug, lang, compact = false }: { slug: string; lang: Lang; compact?: boolean }) {
  const t = makeT(lang);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [data, setData] = useState<Payload | null>(null);

  async function ask() {
    setState("loading");
    try {
      const r = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, lang }) });
      const j = (await r.json()) as Payload;
      setData(j);
      setState(r.ok ? "done" : "error");
    } catch { setState("error"); }
  }

  const verdictLabel = { variance: t("reviewVariance"), repeatable_error: t("reviewError"), mixed: t("reviewMixed") };
  const verdictTone = { variance: "text-fg-muted border-line-strong", repeatable_error: "text-warn border-warn", mixed: "text-fg-muted border-line-strong" };

  if (state === "idle") return <button onClick={() => void ask()} className={`rounded-control border border-line-strong px-3 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg ${compact ? "text-label" : "text-sm"}`} data-testid="why-lost">{t("whyLost")}</button>;
  if (state === "loading") return <p className="text-tiny text-fg-dim" data-testid="review-loading">{t("reviewLoading")}</p>;

  const legs = data?.legs ?? [];
  return (
    <div className="flex flex-col gap-3 rounded-panel border border-line bg-surface-1 p-(--panel-p) text-sm" data-testid="loss-review">
      {state === "error" && <p className="text-warn">{data?.message ?? t("reviewFailed")}</p>}
      {state === "done" && data && !data.available && <p className="text-tiny text-fg-dim" data-testid="review-fallback">{t("reviewUnavailable")}</p>}
      {data?.review ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-control border px-2.5 py-0.5 text-label u-label ${verdictTone[data.review.verdict]}`} data-testid="review-verdict">{verdictLabel[data.review.verdict]}</span>
            {data.createdAt && <span className="text-label text-fg-dim">{t("reviewCached")} {formatDate(data.createdAt, lang, { year: true })}</span>}
          </div>
          <div><h4 className="text-micro u-label text-fg-dim">{t("reviewAssumed")}</h4><p className="mt-1 leading-relaxed text-fg-muted">{data.review.assumed}</p></div>
          <div><h4 className="text-micro u-label text-fg-dim">{t("reviewHappened")}</h4><p className="mt-1 leading-relaxed text-fg-muted">{data.review.happened}</p></div>
          <div><h4 className="text-micro u-label text-fg-dim">{t("reviewVerdict")}</h4><p className="mt-1 leading-relaxed text-fg-muted">{data.review.reasoning}</p></div>
          {data.review.keyLeg && <p className="text-tiny text-fg-muted"><span className="font-medium text-fg-muted">{t("reviewKeyLeg")}:</span> {data.review.keyLeg}</p>}
          {data.review.watchNext.length > 0 && (
            <div><h4 className="text-micro u-label text-fg-dim">{t("reviewWatch")}</h4><ul className="mt-1 list-disc pl-4 text-fg-muted">{data.review.watchNext.map((w, i) => <li key={i} className="leading-relaxed">{w}</li>)}</ul></div>
          )}
        </>
      ) : null}
      {legs.length > 0 && (
        <div>
          <h4 className="text-micro u-label text-fg-dim">{t("reviewHappened")}</h4>
          <ul className="nums mt-1 space-y-0.5 text-tiny text-fg-muted" data-testid="review-legs">{legs.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
