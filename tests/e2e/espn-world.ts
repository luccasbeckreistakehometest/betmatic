import fs from "node:fs";
import path from "node:path";

/**
 * A small fake ESPN, written fresh for every run under data/e2e/espn-fixtures and replayed by the
 * dev server (ESPN_FIXTURES). Times are relative to now, so the same specs see an upcoming WNBA
 * slate with posted props, a WNBA game under way, a Brasileirão game about to start with its lineup
 * published, and a finished one from yesterday. Every id is fake (99000xxxx / 7xxx / 88xxx).
 *
 * Each game also carries the slate day it is published on (`day`: -1 yesterday, 0 today, 1
 * tomorrow, in Eastern dates, which is how ESPN indexes a scoreboard). That day is declared, not
 * derived from the kickoff: a run that starts after 19:00 ET would otherwise push "in five hours"
 * onto tomorrow's scoreboard and leave today's slate with only the game already under way — no
 * upcoming game, so no leg pool for the custom parlay and fewer than two games for the cross-game
 * slate. Real scoreboards do the same thing with late kickoffs, and the app reads a day's games
 * from that day's scoreboard, never from the timestamp.
 */
const HOUR = 3_600_000;
const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const COMMON = "https://site.api.espn.com/apis/common/v3/sports";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports";
const CORE = "https://sports.core.api.espn.com/v2/sports";

export const fixtureKey = (url: string) => url.replace(/^https?:\/\//, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 200);
export const etKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).replace(/-/g, "");

type Stat = Record<string, number>;
interface Player { id: string; name: string; pos: string; minutes: number; base: Stat }
interface Team { id: string; abbr: string; name: string; players: Player[] }
/** Which scoreboard a game is published on, as an offset in Eastern days from the run's date. */
export type SlateDay = -1 | 0 | 1;
interface FakeGame {
  id: string; league: "wnba" | "bra.1"; sport: "basketball" | "soccer"; startsAt: Date; day: SlateDay; state: "pre" | "in" | "post";
  home: Team; away: Team; homeMl: number; awayMl: number; total: number; spread: number;
  score?: [number, number]; period?: number; clock?: string; props?: PropSpec[];
}
interface PropSpec { athlete: string; type: string; line: number; over: number; under?: number; open?: number }

const bb = (id: string, name: string, pos: string, minutes: number, pts: number, reb: number, ast: number): Player => ({ id, name, pos, minutes, base: { PTS: pts, REB: reb, AST: ast, "3PT": Math.round(pts / 7), STL: 1, BLK: 0, TO: 2, PF: 2 } });
const fb = (id: string, name: string, pos: string, shots: number, fouls: number): Player => ({ id, name, pos, minutes: 90, base: { G: 0, A: 0, SHOT: shots, SOG: Math.max(0, shots - 1), FC: fouls, FA: 1, OF: 0, YC: 0, RC: 0 } });

const team = (id: string, abbr: string, name: string, players: Player[]): Team => ({ id, abbr, name, players });

export function buildWorld(now = Date.now()) {
  const aces = team("9901", "AUR", "Aurora Aces", [bb("7101", "Ana Lima", "G", 34, 19, 4, 5), bb("7102", "Bia Souza", "F", 31, 11, 8, 2), bb("7103", "Cris Rocha", "G", 12, 5, 2, 1)]);
  const birds = team("9902", "BOR", "Boreal Birds", [bb("7201", "Duda Alves", "G", 33, 16, 3, 6), bb("7202", "Eva Nunes", "C", 29, 12, 9, 1), bb("7203", "Fê Prado", "F", 11, 4, 3, 1)]);
  const comets = team("9903", "CED", "Cedro Comets", [bb("7301", "Gabi Reis", "G", 32, 15, 4, 4)]);
  const divers = team("9904", "DUN", "Dunas Divers", [bb("7401", "Hana Melo", "F", 30, 10, 7, 2)]);
  const e5 = team("9905", "EST", "Estrela Stars", [bb("7501", "Iara Costa", "G", 33, 18, 3, 4)]);
  const f6 = team("9906", "FAR", "Farol Flames", [bb("7601", "Júlia Dias", "F", 32, 14, 8, 2)]);
  const g7 = team("9907", "GAR", "Garoa Gulls", [bb("7701", "Kika Pires", "G", 34, 20, 3, 5)]);
  const h8 = team("9908", "HOR", "Horizonte Hawks", [bb("7801", "Lia Teles", "C", 31, 13, 10, 1)]);
  const tupi = team("9921", "TUP", "Tupi FC", [fb("88001", "Rafa Moura", "F", 3, 1), fb("88002", "Téo Lins", "F", 2, 1), fb("88003", "Ugo Paz", "M", 1, 2)]);
  const ipe = team("9922", "IPE", "Ipê EC", [fb("88101", "Vini Rocha", "F", 2, 1), fb("88102", "Wil Braga", "M", 1, 2)]);

  const games: FakeGame[] = [
    { id: "990000101", league: "wnba", sport: "basketball", startsAt: new Date(now + 5 * HOUR), day: 0, state: "pre", home: aces, away: birds, homeMl: -150, awayMl: 130, total: 160.5, spread: -3.5,
      props: [
        { athlete: "7101", type: "Total Points", line: 17.5, over: 1.87, under: 1.93, open: 1.95 },
        { athlete: "7102", type: "Total Rebounds", line: 6.5, over: 1.8, under: 2.0 },
        { athlete: "7201", type: "Total Points", line: 15.5, over: 1.91, under: 1.89 },
        { athlete: "7202", type: "Total Rebounds", line: 7.5, over: 1.95, under: 1.85, open: 1.83 },
        { athlete: "7103", type: "Total Points", line: 4.5, over: 1.85, under: 1.95 },
        { athlete: "7101", type: "Points Milestones", line: 25, over: 4.7 },
      ] },
    { id: "990000102", league: "wnba", sport: "basketball", startsAt: new Date(now - 1.5 * HOUR), day: 0, state: "in", home: comets, away: divers, homeMl: -120, awayMl: 100, total: 155.5, spread: -1.5, score: [58, 61], period: 3, clock: "5:12" },
    { id: "990000103", league: "wnba", sport: "basketball", startsAt: new Date(now + 6 * HOUR), day: 0, state: "pre", home: e5, away: f6, homeMl: -110, awayMl: -110, total: 158.5, spread: -1.5,
      props: [{ athlete: "7501", type: "Points Milestones", line: 25, over: 4.6 }, { athlete: "7601", type: "Total Rebounds", line: 7.5, over: 1.9, under: 1.9 }] },
    { id: "990000104", league: "wnba", sport: "basketball", startsAt: new Date(now + 7 * HOUR), day: 0, state: "pre", home: g7, away: h8, homeMl: 120, awayMl: -140, total: 162.5, spread: 2.5,
      props: [{ athlete: "7701", type: "Points Milestones", line: 26, over: 4.8 }, { athlete: "7801", type: "Total Rebounds", line: 9.5, over: 1.9, under: 1.9 }] },
    { id: "990000201", league: "bra.1", sport: "soccer", startsAt: new Date(now + 80 * 60_000), day: 0, state: "pre", home: tupi, away: ipe, homeMl: 120, awayMl: 230, total: 2.5, spread: -0.5,
      props: [
        { athlete: "88001", type: "Shots Milestones", line: 2, over: 1.7 }, { athlete: "88002", type: "Shots Milestones", line: 2, over: 2.1 },
        { athlete: "88101", type: "Shots Milestones", line: 2, over: 1.9 }, { athlete: "88102", type: "Fouls Committed Milestones", line: 2, over: 2.0 },
      ] },
    { id: "990000202", league: "bra.1", sport: "soccer", startsAt: new Date(now - 26 * HOUR), day: -1, state: "post", home: tupi, away: ipe, homeMl: 110, awayMl: 250, total: 2.5, spread: -0.5, score: [2, 1] },
  ];
  return { games, teams: [aces, birds, comets, divers, e5, f6, g7, h8, tupi, ipe] };
}

export type World = ReturnType<typeof buildWorld>;
export { HOUR, SITE, COMMON, WEB, CORE };
export type { FakeGame, Team, Player, PropSpec };

export function writeFile(dir: string, url: string, body: unknown) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${fixtureKey(url)}.json`), JSON.stringify(body));
}
