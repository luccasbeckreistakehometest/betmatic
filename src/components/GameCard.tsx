import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";
import { Skeleton, cx } from "@/components/ui";
import { formatNumber, formatTime, localizeStatus, NOT_PRICED } from "@/lib/format";
import { makeT, type Lang } from "@/lib/i18n";
import type { Game, TeamRef } from "@/lib/types";

/** A signed book number the way ESPN prints it: +130, −150, and an em dash when there is none. */
export function signedLine(value: number | undefined, lang: Lang): string {
  if (value === undefined || Number.isNaN(value)) return NOT_PRICED;
  return formatNumber(value, lang, { signed: true });
}

function TeamLine({ team, won, showScore }: { team: TeamRef; won: boolean; showScore: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {team.logo && (
        // ESPN's crest, desaturated and at the size of a glyph (§6.6); a plain img keeps this a server component.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.logo} alt="" width={16} height={16} className="size-4 shrink-0 object-contain opacity-80 saturate-50" />
      )}
      <span className={cx("truncate text-base", won ? "font-medium text-fg" : "text-fg-muted")}>{team.name || team.displayName}</span>
      {showScore && team.score !== undefined && (
        <span className={cx("nums ml-auto shrink-0 pl-3 text-base", won ? "text-fg" : "text-fg-muted")}>{team.score}</span>
      )}
    </span>
  );
}

/** A market's label and number. The label may be cut short; the number never is. */
function Market({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-micro u-label text-fg-dim">{label}</span>
      <span className="nums text-sm whitespace-nowrap text-fg-muted">{value}</span>
    </span>
  );
}

/**
 * One fixture as a card, for the phone: the same six facts as the slate's row — when, who, the
 * score once there is one, and the three market numbers — stacked so a thumb reads them top to
 * bottom, and the whole card is the tap. It is a real link, so a long press, a new tab and a
 * middle click behave as the platform expects without a line of script.
 */
export function GameCard({ game, lang = "pt", sportKey }: { game: Game; lang?: Lang; sportKey?: string }) {
  const t = makeT(lang);
  const scheduled = game.status === "scheduled";
  const final = game.status === "final";
  const live = game.status === "live";
  const homeWon = final && (game.home.score ?? 0) > (game.away.score ?? 0);
  const awayWon = final && (game.away.score ?? 0) > (game.home.score ?? 0);
  const status = live
    ? localizeStatus(game.statusDetail || "Live", lang)
    : final
      ? localizeStatus(game.statusDetail || "Final", lang)
      : formatTime(game.startsAt, lang);
  const total = game.odds?.overUnder !== undefined ? formatNumber(game.odds.overUnder, lang, { digits: 1 }) : NOT_PRICED;
  const moneyline = game.odds ? `${signedLine(game.odds.awayMoneyline, lang)} / ${signedLine(game.odds.homeMoneyline, lang)}` : NOT_PRICED;

  return (
    <li className="u-rule last:shadow-none">
      <Link
        href={{ pathname: `/app/game/${game.id}`, query: { sport: sportKey ?? game.sportKey, lang } }}
        data-testid="game-card"
        data-status={game.status}
        className="u-ring-inset flex items-center gap-3 px-4 py-3 transition-colors duration-(--dur-1) ease-(--ease-out) active:bg-surface-2"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="flex items-center gap-2 text-label">
            {live ? (
              <span className="flex items-center gap-1.5 text-neg">
                <span aria-hidden="true" className="live-dot size-1.5 rounded-full bg-neg" />
                <span className="nums">{status}</span>
              </span>
            ) : (
              <span className={cx("nums", final ? "text-fg-dim" : "text-fg-muted")}>{status}</span>
            )}
            {game.tournament && (
              <span className="truncate text-fg-dim">
                {game.tournament}
                {game.round ? ` · ${game.round}` : ""}
              </span>
            )}
          </span>
          <span className="flex flex-col gap-1">
            <TeamLine team={game.away} won={awayWon} showScore={!scheduled} />
            <TeamLine team={game.home} won={homeWon} showScore={!scheduled} />
          </span>
          {/* The handicap takes what is left; total and winner take exactly their numbers' width,
              so "+100 / −120" is whole at 320px. */}
          {!final && (
            <span className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 gap-y-1 border-t border-line pt-2">
              <Market label={t("spread")} value={game.odds?.details ?? NOT_PRICED} />
              <Market label={t("total")} value={total} />
              <Market label={t("moneyline")} value={moneyline} />
            </span>
          )}
        </span>
        <LinkPending />
      </Link>
    </li>
  );
}

/** The card list while the slate is on its way: the same shape at the same height, never a blank. */
export function GameCardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ul aria-hidden="true" className="md:hidden">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3 u-rule last:shadow-none">
          <span className="flex min-w-0 flex-1 flex-col gap-3">
            <Skeleton width="3.5rem" />
            <span className="flex flex-col gap-2">
              <Skeleton width={`${52 + ((i * 17) % 20)}%`} className="h-4" />
              <Skeleton width={`${44 + ((i * 11) % 24)}%`} className="h-4" />
            </span>
            <span className="grid grid-cols-3 gap-3 border-t border-line pt-2">
              <Skeleton width="4rem" />
              <Skeleton width="3rem" />
              <Skeleton width="5rem" />
            </span>
          </span>
          <span className="size-5 shrink-0" />
        </li>
      ))}
    </ul>
  );
}
