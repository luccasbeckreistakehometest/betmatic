import Link from "next/link";
import { makeT, type Lang } from "@/lib/i18n";
import { formatTime, localizeStatus } from "@/lib/format";
import type { Game, TeamRef } from "@/lib/types";

/** Kickoff in the reader's clock: Brasília for the Portuguese app, Eastern for the English one. */
export function kickoff(iso: string, lang: Lang): string {
  return formatTime(iso, lang);
}

function fmtLine(value?: number): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return value > 0 ? `+${value}` : String(value);
}

function fmtMl(value?: number): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return value > 0 ? `+${value}` : String(value);
}

function TeamRow({ team, winner, showScore }: { team: TeamRef; winner: boolean; showScore: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {team.logo ? (
        // ESPN logo CDN; plain img keeps this a pure server component with no layout shift budget.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.logo} alt="" width={26} height={26} className="size-[26px] shrink-0 object-contain" />
      ) : (
        <span className="grid size-[26px] shrink-0 place-items-center rounded bg-ink-800 text-[10px] text-mist-400">
          {team.abbreviation}
        </span>
      )}
      <span className={`truncate text-sm ${winner ? "font-semibold text-white" : "text-mist-300"}`}>
        {team.name || team.displayName}
      </span>
      <span className="nums ml-auto shrink-0 text-[11px] text-mist-500">{team.record ?? ""}</span>
      {showScore && team.score !== undefined && (
        <span className={`nums w-8 shrink-0 text-right text-sm ${winner ? "font-semibold text-white" : "text-mist-400"}`}>
          {team.score}
        </span>
      )}
    </div>
  );
}

export function GameCard({ game, lang = "pt", sportKey }: { game: Game; lang?: Lang; sportKey?: string }) {
  const t = makeT(lang);
  const isScheduled = game.status === "scheduled";
  const isFinal = game.status === "final";
  const isLive = game.status === "live";
  const homeWon = isFinal && (game.home.score ?? 0) > (game.away.score ?? 0);
  const awayWon = isFinal && (game.away.score ?? 0) > (game.home.score ?? 0);

  return (
    <Link
      href={{ pathname: `/app/game/${game.id}`, query: { sport: sportKey ?? game.sportKey, lang } }}
      className="group flex flex-col gap-3 rounded-xl border border-ink-800 bg-ink-900/70 p-4 transition hover:-translate-y-0.5 hover:border-signal-500/50 hover:bg-ink-850"
    >
      <div className="flex items-center gap-2">
        {game.round && <span className="truncate text-[10px] text-mist-500">{game.round}</span>}
        {isLive ? (
          <span className="live-dot flex items-center gap-1.5 rounded-full bg-alert-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-alert-400">
            <span className="size-1.5 rounded-full bg-alert-400" />
            {localizeStatus(game.statusDetail || "Live", lang)}
          </span>
        ) : (
          <span className="nums text-[11px] font-medium uppercase tracking-wide text-mist-400">
            {isFinal ? localizeStatus(game.statusDetail || "Final", lang) : kickoff(game.startsAt, lang)}
          </span>
        )}
        {game.broadcast && (
          <span className="truncate text-[11px] text-mist-500">{game.broadcast}</span>
        )}
        <span className="ml-auto text-mist-600 opacity-0 transition group-hover:opacity-100">→</span>
      </div>

      <div className="flex flex-col gap-2">
        <TeamRow team={game.away} winner={awayWon} showScore={!isScheduled} />
        <TeamRow team={game.home} winner={homeWon} showScore={!isScheduled} />
      </div>

      {!isFinal && (
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-ink-800 bg-ink-800 text-center">
        <div className="bg-ink-900 px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-mist-500">{t("spread")}</div>
          <div className="nums text-xs text-mist-200">{game.odds?.details ?? "—"}</div>
        </div>
        <div className="bg-ink-900 px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-mist-500">{t("total")}</div>
          <div className="nums text-xs text-mist-200">{fmtLine(game.odds?.overUnder)}</div>
        </div>
        <div className="bg-ink-900 px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-mist-500">{t("moneyline")}</div>
          <div className="nums text-xs text-mist-200">
            {fmtMl(game.odds?.awayMoneyline)} / {fmtMl(game.odds?.homeMoneyline)}
          </div>
        </div>
      </div>
      )}
    </Link>
  );
}
