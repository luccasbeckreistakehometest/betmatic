"use client";

import { useState } from "react";
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
  const verdictTone = { variance: "text-signal-400 border-signal-400/30", repeatable_error: "text-warn-400 border-warn-400/30", mixed: "text-mist-300 border-ink-700" };

  if (state === "idle") return <button onClick={() => void ask()} className={`rounded-lg border border-ink-700 px-3 py-1.5 text-mist-300 hover:border-edge-400/50 hover:text-edge-400 ${compact ? "text-[11px]" : "text-[13px]"}`} data-testid="why-lost">{t("whyLost")}</button>;
  if (state === "loading") return <p className="text-[12px] text-mist-500" data-testid="review-loading">{t("reviewLoading")}</p>;

  const legs = data?.legs ?? [];
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-ink-800 bg-ink-900/70 p-3.5 text-[13px]" data-testid="loss-review">
      {state === "error" && <p className="text-warn-400">{data?.message ?? t("reviewFailed")}</p>}
      {state === "done" && data && !data.available && <p className="text-[12px] text-mist-500" data-testid="review-fallback">{t("reviewUnavailable")}</p>}
      {data?.review ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${verdictTone[data.review.verdict]}`} data-testid="review-verdict">{verdictLabel[data.review.verdict]}</span>
            {data.createdAt && <span className="text-[11px] text-mist-500">{t("reviewCached")} {new Date(data.createdAt).toLocaleDateString(lang === "pt" ? "pt-BR" : "en-US")}</span>}
          </div>
          <div><h4 className="text-[10px] font-semibold uppercase tracking-wider text-mist-500">{t("reviewAssumed")}</h4><p className="mt-1 leading-relaxed text-mist-300">{data.review.assumed}</p></div>
          <div><h4 className="text-[10px] font-semibold uppercase tracking-wider text-mist-500">{t("reviewHappened")}</h4><p className="mt-1 leading-relaxed text-mist-300">{data.review.happened}</p></div>
          <div><h4 className="text-[10px] font-semibold uppercase tracking-wider text-mist-500">{t("reviewVerdict")}</h4><p className="mt-1 leading-relaxed text-mist-300">{data.review.reasoning}</p></div>
          {data.review.keyLeg && <p className="text-[12px] text-mist-400"><span className="font-medium text-mist-300">{t("reviewKeyLeg")}:</span> {data.review.keyLeg}</p>}
          {data.review.watchNext.length > 0 && (
            <div><h4 className="text-[10px] font-semibold uppercase tracking-wider text-mist-500">{t("reviewWatch")}</h4><ul className="mt-1 list-disc pl-4 text-mist-300">{data.review.watchNext.map((w, i) => <li key={i} className="leading-relaxed">{w}</li>)}</ul></div>
          )}
        </>
      ) : null}
      {legs.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-mist-500">{t("reviewHappened")}</h4>
          <ul className="nums mt-1 space-y-0.5 text-[12px] text-mist-400" data-testid="review-legs">{legs.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
