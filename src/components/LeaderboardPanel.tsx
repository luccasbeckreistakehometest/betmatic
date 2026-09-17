"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Empty, Panel } from "@/components/ui";
import { useNavState } from "@/components/Controls";
import { makeT } from "@/lib/i18n";

interface Row { handle: string; decided: number; won: number; lost: number; roi: number; units: number; you: boolean; position: number }
interface Payload { rows: Row[]; period: "week" | "all"; minDecided: number; members: number; viewer: { optedIn: boolean; handle: string | null }; error?: string }

export function LeaderboardPanel() {
  const { lang } = useNavState();
  const t = makeT(lang);
  const [period, setPeriod] = useState<"week" | "all">("week");
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    const id = setTimeout(() => { fetch(`/api/ranking?period=${period}`, { cache: "no-store" }).then((r) => r.json()).then(setData).catch(() => {}); }, 0);
    return () => clearTimeout(id);
  }, [period]);

  if (data?.error) return <Panel title={t("rankingTitle")}><Empty>{t("signInForRanking")}</Empty><Link href="/login" className="mt-2 inline-block text-[13px] text-edge-400 hover:underline">{lang === "pt" ? "Entrar" : "Log in"}</Link></Panel>;
  const pct = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
  const units = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}u`;
  const tone = (n: number) => (n > 0 ? "text-signal-400" : n < 0 ? "text-warn-400" : "text-mist-300");

  return (
    <div className="flex flex-col gap-4" data-testid="ranking">
      <Panel title={t("rankingTitle")} meta={data ? `${data.members} ${t("rankingMembers")}` : undefined}
        action={
          <div className="flex overflow-hidden rounded-lg border border-ink-700 text-[11px]">
            {(["week", "all"] as const).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} data-testid={`period-${p}`} className={`px-2.5 py-1 ${period === p ? "bg-ink-700 text-mist-100" : "text-mist-500 hover:text-mist-200"}`}>{p === "week" ? t("rankingWeek") : t("rankingAll")}</button>
            ))}
          </div>
        }>
        <p className="text-[12px] text-mist-500">{t("rankingIntro").replace("{n}", String(data?.minDecided ?? 10))}</p>
        {data && !data.viewer.optedIn && (
          <p className="mt-2 text-[12px] text-mist-400" data-testid="ranking-not-in">{t("rankingNotIn")} <Link href={{ pathname: "/app/settings", query: { lang } }} className="text-edge-400 hover:underline">{t("navSettings")} →</Link></p>
        )}
        {data?.rows.length ? (
          <table className="mt-4 w-full text-left text-[13px]" data-testid="ranking-table">
            <thead><tr className="border-b border-ink-800 text-[10px] uppercase tracking-wider text-mist-500"><th className="pb-1.5 font-medium">#</th><th className="pb-1.5 font-medium">{t("handle")}</th><th className="pb-1.5 text-right font-medium">{t("record")}</th><th className="pb-1.5 text-right font-medium">{t("roi")}</th><th className="pb-1.5 text-right font-medium">{t("rankingUnits")}</th></tr></thead>
            <tbody className="divide-y divide-ink-800/70">
              {data.rows.map((r) => (
                <tr key={r.handle} className={r.you ? "bg-edge-400/5" : ""} data-testid="ranking-row" data-you={r.you ? "1" : "0"}>
                  <td className="nums py-2 text-mist-500">{r.position}</td>
                  <td className="py-2 text-mist-100">@{r.handle}{r.you && <span className="ml-2 rounded border border-edge-400/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-edge-400">{t("rankingYou")}</span>}</td>
                  <td className="nums py-2 text-right text-mist-300">{r.won}W {r.lost}L</td>
                  <td className={`nums py-2 text-right font-semibold ${tone(r.roi)}`}>{pct(r.roi)}</td>
                  <td className={`nums py-2 text-right ${tone(r.units)}`}>{units(r.units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : data ? <p className="mt-4 text-[13px] text-mist-500" data-testid="ranking-empty">{t("rankingEmpty")}</p> : null}
      </Panel>
    </div>
  );
}
