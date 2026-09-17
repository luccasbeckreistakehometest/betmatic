"use client";

import Link from "next/link";
import { Panel } from "@/components/ui";
import type { DeepContext } from "@/lib/server/deep-slip";
import type { Lang } from "@/lib/i18n";

const C = {
  pt: {
    title: "Conferência perna a perna", meta: "{n} de {total} pernas encontradas nos próximos jogos",
    notFound: "não achamos esse jogo/jogador nos próximos jogos", measured: "passou da linha", book: "odd da casa", fair: "sem margem", best: "melhor odd entre {n} casas",
    role: { starter: "titular", rotation: "rotação", fringe: "pouco usado", unknown: "papel incerto" } as Record<string, string>,
    injury: "lesão", flags: "Correlação", noFlags: "Nenhuma perna briga com outra nem anda junto no mesmo jogo.", deepDive: "raio-x",
    kind: { player: "jogador", moneyline: "vencedor", draw: "empate", total: "total", unknown: "?" } as Record<string, string>,
    lineMoved: "a casa publicou {line}, não a sua linha",
  },
  en: {
    title: "Leg-by-leg check", meta: "{n} of {total} legs found on the upcoming slate",
    notFound: "couldn't find this game or player on the upcoming slate", measured: "cleared the line", book: "book price", fair: "no-vig", best: "best price across {n} books",
    role: { starter: "starter", rotation: "rotation", fringe: "fringe", unknown: "role unclear" } as Record<string, string>,
    injury: "injury", flags: "Correlation", noFlags: "No legs pull against each other or move together in the same game.", deepDive: "deep dive",
    kind: { player: "player", moneyline: "moneyline", draw: "draw", total: "total", unknown: "?" } as Record<string, string>,
    lineMoved: "the book posted {line}, not your line",
  },
};

const n2 = (n: number, lang: Lang) => (lang === "pt" ? n.toFixed(2).replace(".", ",") : n.toFixed(2));

/** The deterministic half of the deep analysis: shown even when the verdict could not be written. */
export function DeepSlipTable({ ctx, lang, sportKey }: { ctx: DeepContext; lang: Lang; sportKey: string }) {
  const c = C[lang];
  return (
    <Panel title={c.title} lang={lang} meta={c.meta.replace("{n}", String(ctx.resolved)).replace("{total}", String(ctx.legs.length))}>
      <ul className="flex flex-col divide-y divide-ink-800" data-testid="deep-table">
        {ctx.legs.map((l) => (
          <li key={l.index} className="py-2 text-[12px]" data-testid="deep-leg">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="nums text-[10px] text-mist-600">{l.index + 1}</span>
              <span className="font-medium text-mist-100">{l.selection}</span>
              <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-mist-400">{c.kind[l.kind]}</span>
              {l.matchup && <span className="text-[11px] text-mist-500">{l.matchup}</span>}
            </div>
            {l.kind === "unknown" ? (
              <p className="mt-0.5 text-[11.5px] text-warn-400">{c.notFound}</p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-mist-400">
                {l.measured && <span className="nums" data-testid="deep-measured">{c.measured}: L5 {l.measured.last5} · L10 {l.measured.last10} · {lang === "pt" ? "temp" : "season"} {l.measured.season}</span>}
                {l.posted && <span className="nums">{c.book} {n2(l.posted.decimal, lang)}{l.posted.noVigFair !== null ? ` · ${c.fair} ${Math.round(l.posted.noVigFair * 100)}%` : ""}</span>}
                {l.posted && l.line !== null && l.posted.line && l.posted.line !== l.line && <span className="text-warn-400">{c.lineMoved.replace("{line}", String(l.posted.line))}</span>}
                {l.bestPrice && l.bestPrice.books > 1 && <span className="nums">{c.best.replace("{n}", String(l.bestPrice.books))}: {n2(l.bestPrice.decimal, lang)}</span>}
                {l.role && <span>{c.role[l.role] ?? l.role}</span>}
                {l.injury && <span className="text-alert-400">{c.injury}: {l.injury}</span>}
                {l.athleteId && <Link href={{ pathname: `/app/player/${l.athleteId}`, query: { sport: sportKey, lang, ...(l.gameId ? { game: l.gameId } : {}) } }} className="underline decoration-ink-600 underline-offset-2 hover:text-mist-100">{c.deepDive}</Link>}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 border-t border-ink-800 pt-2" data-testid="deep-flags">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-mist-500">{c.flags}</h3>
        {ctx.flags.length ? (
          <ul className="mt-1 flex flex-col gap-1">{ctx.flags.map((f, i) => <li key={i} className="text-[12px] text-warn-400">{f}</li>)}</ul>
        ) : (
          <p className="mt-1 text-[12px] text-mist-500">{c.noFlags}</p>
        )}
      </div>
    </Panel>
  );
}
