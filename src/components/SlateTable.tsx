import Link from "next/link";
import { Badge, Empty, Table, Td, Th, Tr } from "@/components/ui";
import { formatTime, localizeStatus } from "@/lib/format";
import { makeT, type Lang } from "@/lib/i18n";
import type { Game, TeamRef } from "@/lib/types";

/** Kickoff in the reader's clock: Brasília for the Portuguese app, Eastern for the English one. */
export function kickoff(iso: string, lang: Lang): string {
  return formatTime(iso, lang);
}

function line(value?: number): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return value > 0 ? `+${value}` : String(value);
}

/**
 * The slate is a table, because that is what a slate is: one row per fixture, the same six facts in
 * the same six places, scanned top to bottom in a second. The crest is demoted to 16px after the
 * name (§16) and dropped entirely below the tablet breakpoint, where the row becomes a definition
 * list — the abbreviation carries the team there.
 */
function Side({ team, won, score }: { team: TeamRef; won: boolean; score: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={`truncate ${won ? "font-medium text-fg" : "text-fg-muted"}`}>{team.name || team.displayName}</span>
      {team.logo ? (
        // ESPN logo CDN; a plain img keeps this a pure server component.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.logo} alt="" width={16} height={16} className="hidden size-4 shrink-0 object-contain opacity-55 lg:block" />
      ) : null}
      {score && team.score !== undefined && (
        <span className={`nums ml-auto shrink-0 text-sm ${won ? "text-fg" : "text-fg-dim"}`}>{team.score}</span>
      )}
    </span>
  );
}

export function SlateTable({ games, lang = "pt", sportKey }: { games: Game[]; lang?: Lang; sportKey?: string }) {
  const t = makeT(lang);
  if (!games.length) return <div className="p-(--panel-p)"><Empty>{t("noGamesNearby")}</Empty></div>;

  return (
    <Table caption={t("slate")}>
      <thead>
        <tr>
          <Th className="w-20">{lang === "pt" ? "Início" : "Start"}</Th>
          <Th>{lang === "pt" ? "Visitante" : "Away"}</Th>
          <Th>{lang === "pt" ? "Casa" : "Home"}</Th>
          <Th numeric className="w-24">{t("spread")}</Th>
          <Th numeric className="w-20">{t("total")}</Th>
          <Th numeric className="w-28">{t("moneyline")}</Th>
        </tr>
      </thead>
      <tbody data-tour="games">
        {games.map((game) => {
          const scheduled = game.status === "scheduled";
          const final = game.status === "final";
          const live = game.status === "live";
          const homeWon = final && (game.home.score ?? 0) > (game.away.score ?? 0);
          const awayWon = final && (game.away.score ?? 0) > (game.home.score ?? 0);
          return (
            <Tr key={game.id} className="group">
              <Td label={lang === "pt" ? "Início" : "Start"} className="relative">
                {/* One link per row, stretched over the row: the whole line is the target, and the
                    accessible name is still the two teams. */}
                <Link
                  href={{ pathname: `/app/game/${game.id}`, query: { sport: sportKey ?? game.sportKey, lang } }}
                  className="after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-(--focus)"
                >
                  <span className="sr-only">
                    {game.away.displayName} × {game.home.displayName} —{" "}
                  </span>
                  {live ? (
                    <Badge tone="neg">
                      <span aria-hidden="true" className="live-dot mr-1 size-1.5 rounded-full bg-neg" />
                      {localizeStatus(game.statusDetail || "Live", lang)}
                    </Badge>
                  ) : (
                    <span className="nums text-tiny text-fg-muted">
                      {final ? localizeStatus(game.statusDetail || "Final", lang) : kickoff(game.startsAt, lang)}
                    </span>
                  )}
                </Link>
              </Td>
              <Td label={lang === "pt" ? "Visitante" : "Away"} className="min-w-0">
                <Side team={game.away} won={awayWon} score={!scheduled} />
              </Td>
              <Td label={lang === "pt" ? "Casa" : "Home"} className="min-w-0">
                <Side team={game.home} won={homeWon} score={!scheduled} />
              </Td>
              <Td numeric label={t("spread")} className="text-fg-muted">
                {final ? "—" : (game.odds?.details ?? "—")}
              </Td>
              <Td numeric label={t("total")} className="text-fg-muted">
                {final ? "—" : line(game.odds?.overUnder)}
              </Td>
              <Td numeric label={t("moneyline")} className="text-fg-muted">
                {final ? "—" : `${line(game.odds?.awayMoneyline)} / ${line(game.odds?.homeMoneyline)}`}
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
