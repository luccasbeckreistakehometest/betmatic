import Link from "next/link";
import { notFound } from "next/navigation";
import { IntelBoard } from "@/components/IntelBoard";
import { LivePanel } from "@/components/LivePanel";
import { espnDateKey } from "@/lib/sources/espn";
import { Empty, KeyValue, Panel } from "@/components/ui";
import { kickoff } from "@/components/SlateTable";
import { localizeStatLabel, localizeStatus } from "@/lib/format";
import { scrubGameDetail } from "@/lib/server/whitelabel";
import { getGameDetail } from "@/lib/sources/espn";
import { FollowButton } from "@/components/FollowButton";
import { currentUser } from "@/lib/server/session";
import { listFollows } from "@/lib/server/telegram";
import { makeT, normaliseLang } from "@/lib/i18n";
import { getSport, sportSellsTickets } from "@/lib/sports";
import { getGameLines, type ProviderLines } from "@/lib/sources/espn-props";
import type { InjuryEntry, TeamRef } from "@/lib/types";

export const dynamic = "force-dynamic";

function money(value?: number): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return value > 0 ? `+${value}` : String(value);
}

const OUT_STATUSES = ["out", "suspension", "injured reserve"];

/** Pre-match tickets are not built once the game is under way. */
const hasStarted = (game: { status: string; startsAt: string }) => game.status !== "scheduled" || Date.parse(game.startsAt) <= Date.now();

function injuryTone(status: string): string {
  const s = status.toLowerCase();
  if (OUT_STATUSES.some((x) => s.includes(x))) return "text-alert-400";
  if (s.includes("doubtful")) return "text-alert-400/80";
  if (s.includes("questionable") || s.includes("day-to-day")) return "text-warn-400";
  return "text-mist-400";
}

function TeamHeading({ team, align, showScore, follow }: { team: TeamRef; align: "left" | "right"; showScore: boolean; follow: { sportKey: string; initial: boolean; signedIn: boolean } }) {
  return (
    <div className={`flex flex-1 items-center gap-3 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      {team.logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.logo} alt="" width={44} height={44} className="size-11 object-contain" />
      )}
      <div>
        <div className="text-[15px] font-semibold tracking-tight text-white">{team.displayName}</div>
        <div className="nums text-[12px] text-mist-500">{team.record ?? ""}</div>
        <div className="mt-1"><FollowButton sportKey={follow.sportKey} teamId={team.id} label={team.displayName} initial={follow.initial} signedIn={follow.signedIn} /></div>
      </div>
      {showScore && team.score !== undefined && (
        <div className="nums text-2xl font-semibold text-white">{team.score}</div>
      )}
    </div>
  );
}

function InjuryList({ injuries, abbreviation }: { injuries: InjuryEntry[]; abbreviation: string }) {
  const rows = injuries.filter((i) => i.teamAbbreviation === abbreviation);
  if (!rows.length) return <p className="text-[12px] text-mist-500">—</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((injury, i) => (
        <li key={`${injury.player}-${i}`}>
          <div className="flex items-baseline gap-2">
            <span className="text-[12px] text-mist-100">{injury.player}</span>
            <span className="text-[10px] text-mist-500">{injury.position ?? ""}</span>
            <span className={`ml-auto text-[11px] font-medium ${injuryTone(injury.status)}`}>{injury.status}</span>
          </div>
          {injury.detail && <p className="text-[11px] leading-snug text-mist-500">{injury.detail}</p>}
        </li>
      ))}
    </ul>
  );
}

/** "abriu 1,67 → agora 1,62 ↘": how the first book with an opening line has moved. */
function LineMovement({ lines, home, away, lang }: { lines: ProviderLines[]; home: string; away: string; lang: "pt" | "en" }) {
  const book = lines.find((l) => l.open && l.current);
  if (!book?.open || !book.current) return null;
  const fmt = (n: number) => (lang === "pt" ? n.toFixed(2).replace(".", ",") : n.toFixed(2));
  const rows: { label: string; from: number; to: number; isLine?: boolean }[] = [];
  const add = (label: string, from: number | null, to: number | null, isLine = false) => {
    if (from !== null && to !== null && Math.abs(from - to) >= (isLine ? 0.25 : 0.01)) rows.push({ label, from, to, isLine });
  };
  add(away, book.open.awayMl, book.current.awayMl);
  add(home, book.open.homeMl, book.current.homeMl);
  add(lang === "pt" ? "linha de total" : "total line", book.open.total, book.current.total, true);
  add(lang === "pt" ? "mais de" : "over", book.open.over, book.current.over);
  if (!rows.length) return null;
  return (
    <div className="mt-3 border-t border-ink-800 pt-2.5" data-testid="line-movement">
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mist-500">{lang === "pt" ? "Movimento desde a abertura" : "Movement since the open"}</h3>
      <ul className="flex flex-col gap-0.5">
        {rows.map((r) => {
          // A shorter price means money came in on that side; a higher total line means the market expects more.
          const up = r.to > r.from;
          return (
            <li key={r.label} className="nums flex items-center justify-between gap-2 text-[12px] text-mist-300">
              <span className="truncate">{r.label}</span>
              <span>{r.isLine ? r.from : fmt(r.from)} → {r.isLine ? r.to : fmt(r.to)} <span className={up ? "text-warn-400" : "text-edge-400"}>{up ? "↗" : "↘"}</span></span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default async function GamePage({ params, searchParams }: PageProps<"/app/game/[gameId]">) {
  const { gameId } = await params;
  const query = await searchParams;
  const lang = normaliseLang(typeof query.lang === "string" ? query.lang : undefined);
  const sport = getSport(typeof query.sport === "string" ? query.sport : undefined);
  const t = makeT(lang);
  const raw = /^[\w-]{1,40}$/.test(gameId) ? await getGameDetail(gameId, false, sport.key).catch(() => null) : null;
  if (!raw) notFound();
  // Follow state is read here so the buttons render with their real value, no client round-trip.
  const user = await currentUser();
  const admin = user?.role === "admin";
  // Non-admins never see which book or feed a number came from.
  const detail = scrubGameDetail(raw, admin ? "admin" : "user", lang);
  const followed = new Set(user ? listFollows(user.id).filter((f) => f.kind === "team" && f.sportKey === sport.key).map((f) => f.key) : []);
  const followOf = (teamId: string) => ({ sportKey: sport.key, initial: followed.has(teamId), signedIn: !!user });

  const { game, books, ats, injuries, teamStats, predictor, leaders, lastMeetings } = detail;
  const lines = sportSellsTickets(sport) && game.status === "scheduled" ? await getGameLines(sport.key, game.id).catch(() => []) : [];

  return (
    <div className="flex flex-col gap-5">
      <Link
        href={{ pathname: "/app", query: { sport: sport.key, lang } }}
        className="w-fit text-[12px] text-mist-500 transition hover:text-mist-300"
      >
        {t("backToSlate")}
      </Link>

      <section className="rounded-xl border border-ink-800 bg-ink-900/60 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <TeamHeading team={game.away} align="left" showScore={game.status !== "scheduled"} follow={followOf(game.away.id)} />
          <div className="flex shrink-0 flex-col items-center gap-1 px-2">
            <span className="text-[11px] uppercase tracking-widest text-mist-500">
              {game.status === "scheduled" ? kickoff(game.startsAt, lang) : localizeStatus(game.statusDetail, lang)}
            </span>
          </div>
          <TeamHeading team={game.home} align="right" showScore={game.status !== "scheduled"} follow={followOf(game.home.id)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-ink-800 pt-3 text-[12px] text-mist-500">
          {game.tournament && <span className="text-mist-300">{game.tournament}</span>}
          {game.round && <span>{game.round}</span>}
          {game.venue && <span>{game.venue}</span>}
          {game.broadcast && <span>{game.broadcast}</span>}
          {game.odds?.details && <span className="nums text-mist-300">{game.odds.details}</span>}
          {game.odds?.overUnder !== undefined && (
            <span className="nums text-mist-300">O/U {game.odds.overUnder}</span>
          )}
          {predictor?.homeWinPct !== undefined && (
            <span className="nums">
              {admin ? "ESPN win prob" : t("winProb")}: {game.away.abbreviation} {Math.round(predictor.awayWinPct ?? 0)}% ·{" "}
              {game.home.abbreviation} {Math.round(predictor.homeWinPct ?? 0)}%
            </span>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {user && sportSellsTickets(sport) && game.status !== "scheduled" && (
            <LivePanel gameId={gameId} sportKey={sport.key} dateKey={espnDateKey(new Date(game.startsAt))} lang={lang} />
          )}
          {sportSellsTickets(sport) ? (
            <IntelBoard gameId={gameId} dateKey={espnDateKey(new Date(game.startsAt))} started={hasStarted(game)} />
          ) : (
            <Panel title={t("betBuilder")} lang={lang}>
              <Empty>{t("tennisUnsupported")}</Empty>
            </Panel>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <Panel title={t("injuryReport")} meta={admin ? "ESPN" : undefined}>
            <div className="flex flex-col gap-3">
              <div>
                <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-mist-500">
                  {game.away.displayName}
                </h3>
                <InjuryList injuries={injuries} abbreviation={game.away.abbreviation} />
              </div>
              <div className="border-t border-ink-800 pt-3">
                <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-mist-500">
                  {game.home.displayName}
                </h3>
                <InjuryList injuries={injuries} abbreviation={game.home.abbreviation} />
              </div>
            </div>
          </Panel>

          {sport.hasPlayerGamelog && detail.rosters.some((r) => r.athletes?.length) && (
            <Panel title={lang === "pt" ? "Raio-x do jogador" : "Player deep dive"}>
              <p className="mb-2 text-[11.5px] leading-relaxed text-mist-500">
                {lang === "pt" ? "Histórico jogo a jogo, linha que você escolhe, minutagem e o \"com e sem\" o companheiro." : "Game-by-game log, any line you pick, minutes and the with/without-teammate split."}
              </p>
              <div className="flex flex-col gap-2.5" data-testid="player-links">
                {[game.away, game.home].map((team) => {
                  const roster = detail.rosters.find((r) => r.teamAbbreviation === team.abbreviation)?.athletes ?? [];
                  if (!roster.length) return null;
                  return (
                    <div key={team.id}>
                      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mist-500">{team.displayName}</h3>
                      <div className="flex flex-wrap gap-1">
                        {roster.slice(0, 14).map((a) => (
                          <Link key={a.id} href={{ pathname: `/app/player/${a.id}`, query: { sport: sport.key, lang, game: game.id } }} className="rounded border border-ink-700 px-1.5 py-0.5 text-[11px] text-mist-300 hover:border-edge-400 hover:text-mist-100">
                            {a.name}
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          <Panel title={t("market")} meta={books.length ? `${books.length} ${books.length === 1 ? t("bookOne") : t("bookMany")}` : undefined}>
            {books.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-ink-800 text-[10px] uppercase tracking-wider text-mist-500">
                      <th className="pb-1.5 font-medium">{t("book")}</th>
                      <th className="pb-1.5 font-medium">{t("spread")}</th>
                      <th className="pb-1.5 text-right font-medium">{t("total")}</th>
                      <th className="pb-1.5 text-right font-medium">{t("moneyline")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-800/70">
                    {books.map((book, i) => (
                      <tr key={`${book.provider}-${i}`}>
                        <td className="py-1.5 text-mist-300">{book.provider ?? "—"}</td>
                        <td className="nums py-1.5 text-mist-100">{book.details ?? "—"}</td>
                        <td className="nums py-1.5 text-right text-mist-100">{book.overUnder ?? "—"}</td>
                        <td className="nums py-1.5 text-right text-mist-200">
                          {money(book.awayMoneyline)} / {money(book.homeMoneyline)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>{t("noLines")}</Empty>
            )}
            <LineMovement lines={lines} home={game.home.displayName} away={game.away.displayName} lang={lang} />
            {ats.length > 0 && (
              <div className="mt-3 border-t border-ink-800 pt-2.5">
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mist-500">
                  {t("againstSpread")}
                </h3>
                {ats.map((row) => (
                  <p key={row.teamAbbreviation} className="nums text-[12px] text-mist-300">
                    {row.teamAbbreviation} {row.record}
                  </p>
                ))}
              </div>
            )}
          </Panel>

          {leaders.length > 0 && (
            <Panel title={t("leaders")}>
              <KeyValue
                rows={leaders.slice(0, 8).map((l) => ({
                  label: `${l.player} (${l.teamAbbreviation})`,
                  value: l.line,
                }))}
              />
            </Panel>
          )}

          {(teamStats.away.length > 0 || teamStats.home.length > 0) && (
            <Panel title={t("teamStats")}>
              <div className="grid grid-cols-2 gap-4">
                {([
                  [game.away.abbreviation, teamStats.away],
                  [game.home.abbreviation, teamStats.home],
                ] as const).map(([abbr, stats]) => (
                  <div key={abbr}>
                    <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-mist-500">{abbr}</h3>
                    <KeyValue emptyText={t("nothingReported")} rows={stats.slice(0, 10).map((s) => ({ label: localizeStatLabel(s.label, lang), value: s.value, hint: s.rank }))} />
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {lastMeetings.length > 0 && (
            <Panel title={t("seasonSeries")}>
              <ul className="flex flex-col gap-1">
                {lastMeetings.map((m, i) => (
                  <li key={i} className="nums text-[12px] text-mist-300">
                    {m.summary}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}
