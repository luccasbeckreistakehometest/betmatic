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

  if (data?.error) return <Panel title={t("rankingTitle")}><Empty>{t("signInForRanking")}</Empty><Link href="/login" className="mt-2 inline-block text-sm text-pos hover:underline">{lang === "pt" ? "Entrar" : "Log in"}</Link></Panel>;
  const pct = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
  const units = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}u`;
  const tone = (n: number) => (n > 0 ? "text-focus" : n < 0 ? "text-warn" : "text-fg-muted");

  return (
    <div className="flex flex-col gap-4" data-testid="ranking">
      <Panel title={t("rankingTitle")} meta={data ? `${data.members} ${t("rankingMembers")}` : undefined}
        action={
          <div className="flex overflow-hidden rounded-control border border-line-strong text-label">
            {(["week", "all"] as const).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} data-testid={`period-${p}`} className={`px-2.5 py-1 ${period === p ? "bg-surface-3 text-fg" : "text-fg-dim hover:text-fg"}`}>{p === "week" ? t("rankingWeek") : t("rankingAll")}</button>
            ))}
          </div>
        }>
        <p className="text-tiny text-fg-dim">{t("rankingIntro").replace("{n}", String(data?.minDecided ?? 10))}</p>
        {data && !data.viewer.optedIn && (
          <p className="mt-2 text-tiny text-fg-muted" data-testid="ranking-not-in">{t("rankingNotIn")} <Link href={{ pathname: "/app/settings", query: { lang } }} className="text-pos hover:underline">{t("navSettings")} →</Link></p>
        )}
        {data?.rows.length ? (
          <table className="mt-4 w-full text-left text-sm" data-testid="ranking-table">
            <thead><tr className="border-b border-line text-micro uppercase tracking-wider text-fg-dim"><th className="pb-1.5 font-medium">#</th><th className="pb-1.5 font-medium">{t("handle")}</th><th className="pb-1.5 text-right font-medium">{t("record")}</th><th className="pb-1.5 text-right font-medium">{t("roi")}</th><th className="pb-1.5 text-right font-medium">{t("rankingUnits")}</th></tr></thead>
            <tbody className="divide-y divide-line/70">
              {data.rows.map((r) => (
                <tr key={r.handle} className={r.you ? "bg-action" : ""} data-testid="ranking-row" data-you={r.you ? "1" : "0"}>
                  <td className="nums py-2 text-fg-dim">{r.position}</td>
                  <td className="py-2 text-fg">@{r.handle}{r.you && <span className="ml-2 rounded-control border border-pos px-1.5 py-0.5 text-micro uppercase tracking-wide text-pos">{t("rankingYou")}</span>}</td>
                  <td className="nums py-2 text-right text-fg-muted">{r.won}W {r.lost}L</td>
                  <td className={`nums py-2 text-right font-semibold ${tone(r.roi)}`}>{pct(r.roi)}</td>
                  <td className={`nums py-2 text-right ${tone(r.units)}`}>{units(r.units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : data ? <p className="mt-4 text-sm text-fg-dim" data-testid="ranking-empty">{t("rankingEmpty")}</p> : null}
      </Panel>
    </div>
  );
}
