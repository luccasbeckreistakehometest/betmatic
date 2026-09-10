import Link from "next/link";
import type { Game, TeamRef } from "@/lib/types";

/** Tipoff is always shown in Eastern time — it is the league's own clock and avoids hydration drift. */
export function tipoffET(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
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

export function GameCard({ game }: { game: Game }) {
  const isScheduled = game.status === "scheduled";
  const isFinal = game.status === "final";
  const isLive = game.status === "live";
  const homeWon = isFinal && (game.home.score ?? 0) > (game.away.score ?? 0);
  const awayWon = isFinal && (game.away.score ?? 0) > (game.home.score ?? 0);

  return (
    <Link
      href={`/game/${game.id}`}
      className="group flex flex-col gap-3 rounded-xl border border-ink-800 bg-ink-900/70 p-4 transition hover:-translate-y-0.5 hover:border-signal-500/50 hover:bg-ink-850"
    >
      <div className="flex items-center gap-2">
        {isLive ? (
          <span className="live-dot flex items-center gap-1.5 rounded-full bg-alert-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-alert-400">
            <span className="size-1.5 rounded-full bg-alert-400" />
            {game.statusDetail || "Live"}
          </span>
        ) : (
          <span className="nums text-[11px] font-medium uppercase tracking-wide text-mist-400">
            {isFinal ? game.statusDetail || "Final" : `${tipoffET(game.startsAt)} ET`}
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
          <div className="text-[9px] uppercase tracking-wider text-mist-500">Spread</div>
          <div className="nums text-xs text-mist-200">{game.odds?.details ?? "—"}</div>
        </div>
        <div className="bg-ink-900 px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-mist-500">Total</div>
          <div className="nums text-xs text-mist-200">{fmtLine(game.odds?.overUnder)}</div>
        </div>
        <div className="bg-ink-900 px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-mist-500">ML</div>
          <div className="nums text-xs text-mist-200">
            {fmtMl(game.odds?.awayMoneyline)} / {fmtMl(game.odds?.homeMoneyline)}
          </div>
        </div>
      </div>
      )}
    </Link>
  );
}
