import Link from "next/link";
import { Badge, Empty, Table, TableSkeleton, Td, Th } from "@/components/ui";
import { GameCard, GameCardSkeleton } from "@/components/GameCard";
import { GameRow } from "@/components/GameRow";
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
 * name (§16). Below the tablet breakpoint the table leaves and the same fixtures become cards
 * (GameCard): a definition list of six labelled lines per game is a form, not a slate, and a thumb
 * needs one target per game, not six.
 */
function Side({ team, won, score }: { team: TeamRef; won: boolean; score: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={`truncate ${won ? "font-medium text-fg" : "text-fg-muted"}`}>{team.name || team.displayName}</span>
      {team.logo ? (
        // ESPN logo CDN; a plain img keeps this a pure server component.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.logo} alt="" width={16} height={16} className="hidden size-4 shrink-0 object-contain saturate-50 opacity-80 lg:block" />
      ) : null}
      {score && team.score !== undefined && (
        <span className={`nums ml-auto shrink-0 text-sm ${won ? "text-fg" : "text-fg-dim"}`}>{team.score}</span>
      )}
    </span>
  );
}

/** The slate while it is on its way: cards on a phone, the table's own columns on a desk. */
export function SlateSkeleton({ lang = "pt" }: { lang?: Lang }) {
  const t = makeT(lang);
  return (
    <>
      <GameCardSkeleton />
      <div className="hidden md:block">
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
          <TableSkeleton rows={6} columns={[{ width: "3rem" }, { width: "9rem" }, { width: "8rem" }, { width: "4rem", numeric: true }, { width: "3rem", numeric: true }, { width: "6rem", numeric: true }]} />
        </Table>
      </div>
    </>
  );
}

export function SlateTable({ games, lang = "pt", sportKey }: { games: Game[]; lang?: Lang; sportKey?: string }) {
  const t = makeT(lang);
  if (!games.length) return <div className="p-(--panel-p)"><Empty>{t("noGamesNearby")}</Empty></div>;

  return (
    <>
    <ul className="md:hidden" data-tour="games" data-testid="game-cards">
      {games.map((game) => (
        <GameCard key={game.id} game={game} lang={lang} sportKey={sportKey} />
      ))}
    </ul>
    <div className="hidden md:block">
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
            <GameRow key={game.id} href={`/app/game/${game.id}?sport=${encodeURIComponent(sportKey ?? game.sportKey)}&lang=${lang}`} className="group">
              <Td label={lang === "pt" ? "Início" : "Start"}>
                {/* One link per row — the accessible name is still the two teams — and the row itself
                    takes the tap everywhere else (GameRow). */}
                <Link
                  href={{ pathname: `/app/game/${game.id}`, query: { sport: sportKey ?? game.sportKey, lang } }}
                  className="rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus)"
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
            </GameRow>
          );
        })}
      </tbody>
    </Table>
    </div>
    </>
  );
}
