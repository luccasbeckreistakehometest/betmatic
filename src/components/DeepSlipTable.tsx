"use client";

import Link from "next/link";
import { Panel } from "@/components/ui";
import type { DeepContext } from "@/lib/server/deep-slip";
import type { Lang } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";

const C = {
  pt: {
    title: "Conferência linha a linha", meta: "{n} de {total} linhas encontradas nos próximos jogos",
    notFound: "não achamos esse jogo/jogador nos próximos jogos", measured: "passou do número", book: "odd da casa", fair: "sem margem", best: "melhor odd entre {n} casas",
    role: { starter: "titular", rotation: "rotação", fringe: "pouco usado", unknown: "papel incerto" } as Record<string, string>,
    injury: "lesão", flags: "Correlação", noFlags: "Nenhuma linha briga com outra nem anda junto no mesmo jogo.", deepDive: "raio-x",
    kind: { player: "jogador", moneyline: "vencedor", draw: "empate", total: "total", unknown: "?" } as Record<string, string>,
    lineMoved: "a casa publicou {line}, não o número que você pôs",
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

const n2 = (n: number, lang: Lang) => formatNumber(n, lang, { digits: 2 });

/** The deterministic half of the deep analysis: shown even when the verdict could not be written. */
export function DeepSlipTable({ ctx, lang, sportKey }: { ctx: DeepContext; lang: Lang; sportKey: string }) {
  const c = C[lang];
  return (
    <Panel title={c.title} lang={lang} meta={c.meta.replace("{n}", String(ctx.resolved)).replace("{total}", String(ctx.legs.length))}>
      <ul className="flex flex-col divide-y divide-line" data-testid="deep-table">
        {ctx.legs.map((l) => (
          <li key={l.index} className="py-2 text-tiny" data-testid="deep-leg">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="nums text-micro text-fg-dim">{l.index + 1}</span>
              <span className="font-medium text-fg">{l.selection}</span>
              <span className="rounded-control bg-surface-3 px-1.5 py-0.5 text-micro u-label text-fg-muted">{c.kind[l.kind]}</span>
              {l.matchup && <span className="text-label text-fg-dim">{l.matchup}</span>}
            </div>
            {l.kind === "unknown" ? (
              <p className="mt-0.5 text-tiny text-warn">{c.notFound}</p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-tiny text-fg-muted">
                {l.measured && <span className="nums" data-testid="deep-measured">{c.measured}: L5 {l.measured.last5} · L10 {l.measured.last10} · {lang === "pt" ? "temp" : "season"} {l.measured.season}</span>}
                {l.posted && <span className="nums">{c.book} {n2(l.posted.decimal, lang)}{l.posted.noVigFair !== null ? ` · ${c.fair} ${Math.round(l.posted.noVigFair * 100)}%` : ""}</span>}
                {l.posted && l.line !== null && l.posted.line && l.posted.line !== l.line && <span className="text-warn">{c.lineMoved.replace("{line}", String(l.posted.line))}</span>}
                {l.bestPrice && l.bestPrice.books > 1 && <span className="nums">{c.best.replace("{n}", String(l.bestPrice.books))}: {n2(l.bestPrice.decimal, lang)}</span>}
                {l.role && <span>{c.role[l.role] ?? l.role}</span>}
                {l.injury && <span className="text-neg">{c.injury}: {l.injury}</span>}
                {l.athleteId && <Link href={{ pathname: `/app/player/${l.athleteId}`, query: { sport: sportKey, lang, ...(l.gameId ? { game: l.gameId } : {}) } }} className="underline decoration-line-control underline-offset-2 hover:text-fg">{c.deepDive}</Link>}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 border-t border-line pt-2" data-testid="deep-flags">
        <h3 className="text-micro u-label text-fg-dim">{c.flags}</h3>
        {ctx.flags.length ? (
          <ul className="mt-1 flex flex-col gap-1">{ctx.flags.map((f, i) => <li key={i} className="text-tiny text-warn">{f}</li>)}</ul>
        ) : (
          <p className="mt-1 text-tiny text-fg-dim">{c.noFlags}</p>
        )}
      </div>
    </Panel>
  );
}
