import { buildWorld, COMMON, CORE, etKey, HOUR, SITE, WEB, writeFile, type FakeGame, type Player, type Team } from "./espn-world";

const dec = (american: number) => (american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american));
const BB_LABELS = ["MIN", "PTS", "REB", "AST", "STL", "BLK", "TO", "FG", "FG%", "3PT", "3P%", "FT", "FT%", "PF"];
const FB_LABELS = ["G", "A", "SHOT", "SOG", "FC", "FA", "OF", "YC", "RC"];
/** ESPN's athlete-splits label row, in its published order. */
const SPLIT_LABELS = ["GP", "MIN", "FG", "FG%", "3PT", "3P%", "FT", "FT%", "OR", "DR", "REB", "AST", "BLK", "STL", "PF", "TO", "PTS"];

/** One splits row for a player, scaled: `lift` moves her production, `games` is the cut's sample. */
function splitRow(p: Player, displayName: string, abbreviation: string, games: number, lift: number) {
  const n = (x: number) => Number((x * lift).toFixed(1));
  const pts = n(p.base.PTS ?? 0);
  const three = n(p.base["3PT"] ?? 0);
  const stats: Record<string, string> = {
    GP: String(games), MIN: String(n(p.minutes)), FG: `${(pts / 2.4).toFixed(1)}-${(pts / 1.1).toFixed(1)}`, "FG%": "45.0",
    "3PT": `${three.toFixed(1)}-${(three + 2).toFixed(1)}`, "3P%": "35.0", FT: "2.0-2.4", "FT%": "83.0",
    OR: "1.0", DR: String(n((p.base.REB ?? 0) * 0.75)), REB: String(n(p.base.REB ?? 0)), AST: String(n(p.base.AST ?? 0)),
    BLK: String(p.base.BLK ?? 0), STL: String(p.base.STL ?? 0), PF: String(p.base.PF ?? 0), TO: String(p.base.TO ?? 0), PTS: String(pts),
  };
  return { displayName, abbreviation, stats: SPLIT_LABELS.map((l) => stats[l]) };
}

/**
 * The athlete splits feed, in the shape the REAL endpoint publishes (probed 24/09/2026). Home and
 * road are half a season each so the venue cut clears the sample gate; the opponent cuts are two
 * games, which is what the real NBA feed carries and which the gate must refuse — except the one
 * pairing pinned at the gate itself, so the closed world exercises both sides of it.
 */
function athleteSplits(p: Player, opponents: Team[], season: number) {
  const half = 16;
  return {
    displayName: `${season} Splits`,
    labels: SPLIT_LABELS,
    names: SPLIT_LABELS,
    splitCategories: [
      { name: "split", displayName: "split", splits: [
        splitRow(p, "All Splits", "Total", half * 2, 1),
        // A real venue gap, so the block has something to report rather than a rounding difference.
        splitRow(p, "Home", "Home", half, 1.12),
        splitRow(p, "Road", "Road", half, 0.88),
      ] },
      { name: "byMonth", displayName: "Month", splits: [] },
      { name: "byResult", displayName: "Result", splits: [] },
      { name: "byOpponent", displayName: "Opponent", splits: opponents.map((t) =>
        splitRow(p, t.name, `vs ${t.abbr}`, t.abbr === "BOR" ? 5 : 2, 1.05)) },
      { name: "byArena", displayName: "Arena", splits: [] },
    ],
  };
}

const ranked = (name: string, abbreviation: string, value: number, rank: number | null) => ({ name, abbreviation, value, rank });

/**
 * The team season statistics feed, in the core API's shape. `avgPointsAllowed` is included because
 * the WNBA publishes it — the real NBA feed does not, and the adapter leaves it out there.
 */
function teamSeasonStats(t: Team, index: number, season: number) {
  const scored = 82 + index * 2;
  return {
    season: { $ref: `https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/seasons/${season}` },
    team: { $ref: `https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/seasons/${season}/teams/${t.id}` },
    splits: { id: "0", name: "All Splits", abbreviation: "Total", type: "total", categories: [
      { name: "general", stats: [
        ranked("gamesPlayed", "GP", 30, null),
        ranked("avgRebounds", "REB", 33.2 + index, 3 + index),
        ranked("avgFouls", "PF", 18.5 + index, 6),
      ] },
      { name: "defensive", stats: [
        ranked("avgSteals", "STL", 7 + index * 0.2, 5),
        ranked("avgBlocks", "BLK", 3.5 + index * 0.1, 8),
      ] },
      { name: "offensive", stats: [
        ranked("avgPoints", "PTS", scored, 1 + index),
        ranked("avgPointsAllowed", "PAPG", scored - 4, 5 + index),
        ranked("avgEstimatedPossessions", "EP", 95 + index, 2 + index),
        ranked("pointsPerEstimatedPossessions", "PPEP", 1.02, null),
        ranked("avgThreePointFieldGoalsAttempted", "3PA", 25 + index, 7),
        ranked("threePointPct", "3P%", 35.5, 4),
        ranked("avgAssists", "AST", 20.5, 9),
        ranked("avgTurnovers", "TO", 13.1, 8),
      ] },
    ] },
  };
}

function competitor(team: Team, homeAway: "home" | "away", score?: number) {
  return {
    id: team.id, homeAway, score: score !== undefined ? String(score) : undefined,
    team: { id: team.id, abbreviation: team.abbr, displayName: team.name, shortDisplayName: team.name.split(" ")[0], name: team.name },
    records: [{ type: "total", summary: "10-8" }],
  };
}

function status(g: FakeGame) {
  if (g.state === "in") return { clock: 312, displayClock: g.clock, period: g.period, type: { state: "in", completed: false, shortDetail: `${g.clock} - ${g.period}º`, detail: "In Progress" } };
  if (g.state === "post") return { type: { state: "post", completed: true, shortDetail: "FT", detail: "Final" } };
  return { type: { state: "pre", completed: false, shortDetail: "Scheduled", detail: "Scheduled" } };
}

function scoreboardEvent(g: FakeGame) {
  return {
    id: g.id, date: g.startsAt.toISOString(), status: status(g), name: `${g.away.name} at ${g.home.name}`,
    competitions: [{
      competitors: [competitor(g.home, "home", g.score?.[0]), competitor(g.away, "away", g.score?.[1])],
      venue: { fullName: `${g.home.name} Arena` },
      odds: [{ provider: { name: "DraftKings" }, details: `${g.home.abbr} ${g.spread}`, overUnder: g.total, spread: g.spread, homeTeamOdds: { moneyLine: g.homeMl }, awayTeamOdds: { moneyLine: g.awayMl } }],
    }],
  };
}

function statLine(p: Player, i: number, sport: FakeGame["sport"]): string[] {
  const wobble = ((i * 7) % 5) - 2;
  const v = (k: string) => Math.max(0, (p.base[k] ?? 0) + (k === "PTS" ? wobble * 2 : k === "REB" || k === "AST" ? Math.sign(wobble) : k === "SHOT" || k === "FC" ? (i % 3) - 1 : 0));
  if (sport === "soccer") return FB_LABELS.map((k) => String(k === "G" ? (i % 4 === 0 && p.pos === "F" ? 1 : 0) : v(k)));
  const three = v("3PT");
  return BB_LABELS.map((k) => {
    if (k === "MIN") return String(Math.max(1, p.minutes + (((i * 3) % 5) - 2)));
    if (k === "FG") return `${Math.round(v("PTS") / 2.4)}-${Math.round(v("PTS") / 1.1) + 1}`;
    if (k === "3PT") return `${three}-${three + 2}`;
    if (k === "FT") return "2-2";
    if (k.endsWith("%")) return "45.0";
    return String(v(k));
  });
}

function gamelog(p: Player, teamId: string, sport: FakeGame["sport"], now: number) {
  const events: Record<string, unknown> = {};
  const rows = [];
  for (let i = 0; i < 20; i++) {
    // Teammates share event ids, so a "with / without" split has something to split. The bench
    // guard 7103 sits out every fourth game (absent from her log, as ESPN does for a DNP).
    if (p.id === "7103" && i % 4 === 1) continue;
    const eventId = `9800${teamId}${String(i).padStart(2, "0")}`;
    events[eventId] = { id: eventId, gameDate: new Date(now - (i + 2) * 24 * HOUR).toISOString(), opponent: { abbreviation: "OPP" }, atVs: i % 2 ? "@" : "vs", gameResult: i % 3 ? "W" : "L", score: "80-75" };
    rows.push({ eventId, stats: statLine(p, i, sport) });
  }
  return { labels: sport === "soccer" ? FB_LABELS : BB_LABELS, events, seasonTypes: [{ categories: [{ events: rows }] }] };
}

function coreOdds(g: FakeGame) {
  const snap = (shift: number) => ({
    over: { decimal: 1.91 + shift }, under: { decimal: 1.91 - shift }, total: { american: String(g.total) },
    ...(g.sport === "soccer" ? { draw: { decimal: 3.3 } } : {}),
  });
  const side = (american: number, shift: number) => ({ moneyLine: { decimal: Number((dec(american) + shift).toFixed(2)) }, spread: { decimal: 1.91 }, pointSpread: { american: String(g.spread) } });
  const item: Record<string, unknown> = {
    provider: { name: "DraftKings" },
    open: snap(0.04), current: snap(0),
    homeTeamOdds: { open: side(g.homeMl, 0.08), current: side(g.homeMl, 0) },
    awayTeamOdds: { open: side(g.awayMl, -0.05), current: side(g.awayMl, 0) },
  };
  if (g.state === "post") {
    item.close = snap(-0.03);
    (item.homeTeamOdds as Record<string, unknown>).close = side(g.homeMl, -0.1);
    (item.awayTeamOdds as Record<string, unknown>).close = side(g.awayMl, 0.1);
  }
  return { count: 1, items: [item] };
}

function propBets(g: FakeGame) {
  const leagueRef = `${CORE}/${g.sport}/leagues/${g.league}/seasons/2026/athletes`;
  const items = (g.props ?? []).flatMap((p): unknown[] => {
    const athlete = { $ref: `${leagueRef}/${p.athlete}` };
    if (g.sport === "soccer") {
      return [{ athlete, type: { name: p.type }, current: { over: { decimal: p.over }, target: { value: p.line } }, open: { over: { decimal: p.open ?? p.over }, target: { value: p.line } }, lastUpdated: new Date().toISOString() }];
    }
    const row = (price: number, open?: number) => ({
      athlete, type: { name: p.type }, lastUpdated: new Date().toISOString(),
      odds: { decimal: { value: price.toFixed(2), open: (open ?? price).toFixed(2) }, total: { value: String(p.line), open: String(p.line) } },
      current: { target: { value: p.line } }, open: { target: { value: p.line } },
    });
    return p.under ? [row(p.over, p.open), row(p.under)] : [row(p.over, p.open)];
  });
  return { count: items.length, items };
}

/**
 * A play-by-play for the WNBA game under way, so the quarter read has a narration to walk in the
 * closed world as it does against ESPN. Every per-quarter figure below sums to the box score above:
 * Gabi Reis 14pt 5rb 5pf 1to 1stl, Hana Melo 8pt 9rb 2pf 2to 1blk — and Gabi's steal is one of
 * Hana's turnovers, Hana's block one of Gabi's misses, which is how a real feed hangs together.
 *
 * It narrates no assist, and the box score's AST column is left standing. An assist needs a
 * team-mate and each fake team has exactly one player, so a narrated assist here would be a thing
 * that cannot happen. The parser is held to assists against a real 198-play game in the unit specs;
 * what this world is for is the path — narration read, quarters split, block built — and the honest
 * refusal at the end of it: with one player a side the walk cannot field five, so it reports the
 * minutes as not measured rather than inventing them.
 */
function livePlays(g: FakeGame) {
  const HOME = g.home.players[0].id;
  const AWAY = g.away.players[0].id;
  const plays: Record<string, unknown>[] = [];
  let n = 0;
  const play = (period: number, clock: string, text: string, participants: string[], over: Record<string, unknown> = {}) =>
    plays.push({
      id: `${g.id}${++n}`, sequenceNumber: String(n), type: { id: "92", text: "Jump Shot" }, text,
      period: { number: period }, clock: { displayValue: clock }, scoringPlay: false, scoreValue: 0,
      participants: participants.map((id) => ({ athlete: { id } })), ...over,
    });
  const bucket = (period: number, clock: string, who: string) =>
    play(period, clock, `${who === HOME ? g.home.players[0].name : g.away.players[0].name} makes two point shot`, [who], { scoringPlay: true, scoreValue: 2, type: { id: "95", text: "Layup Shot" } });
  const board = (period: number, clock: string, who: string) =>
    play(period, clock, `${who === HOME ? g.home.players[0].name : g.away.players[0].name} defensive rebound`, [who], { type: { id: "155", text: "Defensive Rebound" } });
  const foul = (period: number, clock: string, who: string) =>
    play(period, clock, `${who === HOME ? g.home.players[0].name : g.away.players[0].name} personal foul`, [who], { type: { id: "45", text: "Personal Foul" } });
  const lost = (period: number, clock: string, who: string, stolenBy?: string) =>
    play(period, clock, `${who === HOME ? g.home.players[0].name : g.away.players[0].name} bad pass turnover${stolenBy ? ` (${stolenBy === HOME ? g.home.players[0].name : g.away.players[0].name} steals)` : ""}`,
      stolenBy ? [who, stolenBy] : [who], { type: { id: "62", text: "Bad Pass Turnover" } });
  const swat = (period: number, clock: string, who: string, by: string) =>
    play(period, clock, `${who === HOME ? g.home.players[0].name : g.away.players[0].name} misses layup (${by === HOME ? g.home.players[0].name : g.away.players[0].name} blocks)`, [who, by], { type: { id: "95", text: "Layup Shot" } });

  // Q1 — Gabi 8pt 2rb 1pf 0to 1stl · Hana 2pt 4rb 1pf 1to 0blk
  bucket(1, "9:41", HOME); board(1, "9:12", AWAY); bucket(1, "8:30", HOME); board(1, "7:58", AWAY);
  foul(1, "7:20", HOME); bucket(1, "6:44", AWAY); board(1, "6:02", HOME); lost(1, "5:18", AWAY, HOME);
  bucket(1, "4:33", HOME); board(1, "3:51", AWAY); foul(1, "3:02", AWAY); bucket(1, "2:14", HOME);
  board(1, "1:30", HOME); board(1, "0:47", AWAY);
  // Q2 — Gabi 4pt 2rb 2pf 1to 0stl · Hana 4pt 3rb 0pf 1to 1blk
  bucket(2, "9:35", AWAY); board(2, "9:01", HOME); foul(2, "8:22", HOME); bucket(2, "7:40", HOME);
  board(2, "7:05", AWAY); swat(2, "6:18", HOME, AWAY); board(2, "6:16", AWAY); lost(2, "5:30", HOME);
  bucket(2, "4:52", AWAY); board(2, "4:10", HOME); foul(2, "3:26", HOME); bucket(2, "2:48", HOME);
  lost(2, "1:11", AWAY); board(2, "0:33", AWAY);
  // Q3, still in play at 5:12 — Gabi 2pt 1rb 2pf · Hana 2pt 2rb 1pf
  bucket(3, "9:28", HOME); board(3, "8:50", AWAY); foul(3, "8:11", HOME); bucket(3, "7:29", AWAY);
  board(3, "6:47", HOME); foul(3, "6:10", AWAY); foul(3, "5:41", HOME); board(3, "5:14", AWAY);
  return plays;
}

function summary(g: FakeGame) {
  const out: Record<string, unknown> = {
    header: { competitions: [{ date: g.startsAt.toISOString(), status: status(g), competitors: [competitor(g.home, "home", g.score?.[0]), competitor(g.away, "away", g.score?.[1])] }] },
    pickcenter: [{ provider: { name: "DraftKings" }, details: `${g.home.abbr} ${g.spread}`, spread: g.spread, overUnder: g.total, homeTeamOdds: { moneyLine: g.homeMl, spreadOdds: -110 }, awayTeamOdds: { moneyLine: g.awayMl, spreadOdds: -110 }, overOdds: -110, underOdds: -110 }],
    injuries: g.id === "990000101" ? [{ team: { abbreviation: "BOR" }, injuries: [{ athlete: { displayName: "Fê Prado", position: { abbreviation: "F" } }, status: "Out" }] }] : [],
    leaders: [g.home, g.away].map((t) => ({ team: { abbreviation: t.abbr }, leaders: [{ displayName: "Points", leaders: [{ athlete: { displayName: t.players[0].name }, displayValue: "18.2" }] }] })),
    boxscore: { teams: [], players: [] },
    gameInfo: { officials: g.state === "post" ? [{ displayName: "Árbitro Teste", position: { name: "Referee" } }] : null },
  };
  if (g.sport === "basketball" && g.state === "in") {
    const live: Record<string, string[]> = {
      "7301": ["24", "14", "5-11", "2-4", "2-2", "5", "3", "1", "1", "0", "1", "4", "5", "+3"],
      "7401": ["22", "8", "3-8", "0-1", "2-2", "9", "1", "2", "0", "1", "3", "6", "2", "-3"],
    };
    out.boxscore = {
      teams: [],
      players: [g.home, g.away].map((t) => ({
        team: { id: t.id, abbreviation: t.abbr },
        statistics: [{ labels: ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-"], athletes: t.players.map((p) => ({ athlete: { id: p.id, displayName: p.name }, starter: true, didNotPlay: false, stats: live[p.id] ?? [] })) }],
      })),
    };
    out.plays = livePlays(g);
  }
  if (g.sport === "soccer") {
    const lineupOut = g.state === "pre" && g.startsAt.getTime() - Date.now() < 2 * HOUR;
    out.rosters = lineupOut || g.state !== "pre"
      ? [g.home, g.away].map((t) => ({
          team: { id: t.id, abbreviation: t.abbr }, formation: "4-3-3",
          roster: t.players.map((p) => ({ starter: p.id !== "88002", subbedIn: { didSub: false }, athlete: { id: p.id, displayName: p.name }, position: { abbreviation: p.pos }, stats: g.state === "post" ? [{ name: "totalShots", value: 2 }, { name: "foulsCommitted", value: 1 }] : [] })),
        }))
      : [];
    out.boxscore = { teams: [g.home, g.away].map((t, i) => ({ team: { abbreviation: t.abbr, id: t.id }, statistics: [{ name: "foulsCommitted", displayValue: String(10 + i) }, { name: "yellowCards", displayValue: String(1 + i) }, { name: "wonCorners", displayValue: "4" }, { name: "shotsOnTarget", displayValue: "3" }, { name: "totalShots", displayValue: "9" }] })), players: [] };
  }
  return out;
}

export function writeEspnFixtures(dir: string, now = Date.now()) {
  const { games, teams } = buildWorld(now);
  // A game is published on the scoreboard of its declared slate day, not of its kickoff timestamp:
  // see the note in espn-world.ts. The calendar advertises the same days, for the same reason.
  const dayDate = (d: number) => new Date(now + d * 24 * HOUR);
  for (const league of ["wnba", "bra.1"] as const) {
    const sport = league === "wnba" ? "basketball" : "soccer";
    const played = games.filter((g) => g.league === league);
    const calendar = [...new Set(played.map((g) => dayDate(g.day).toISOString()))];
    // Every day a spec can reach gets a scoreboard, empty when the world has no game on it: the
    // replay only answers URLs it has a file for, and the tipster audit looks a day either side of
    // a pick posted thirty hours ago — an unanswered day went to the real ESPN, and on 20/09/2026 it
    // found a real Palmeiras game for the pick the spec expects to stay unverifiable.
    for (const d of [-4, -3, -2, -1, 0, 1, 2]) {
      const day = etKey(dayDate(d));
      const events = played.filter((g) => g.day === d).map(scoreboardEvent);
      const body = { leagues: [{ calendar }], events };
      writeFile(dir, `${SITE}/${sport}/${league}/scoreboard?dates=${day}&limit=100`, body);
      writeFile(dir, `${SITE}/${sport}/${league}/scoreboard?dates=${day}&limit=1`, body);
    }
  }
  for (const g of games) {
    writeFile(dir, `${SITE}/${g.sport}/${g.league}/summary?event=${g.id}`, summary(g));
    writeFile(dir, `${CORE}/${g.sport}/leagues/${g.league}/events/${g.id}/competitions/${g.id}/odds?limit=100`, coreOdds(g));
    writeFile(dir, `${CORE}/${g.sport}/leagues/${g.league}/events/${g.id}/competitions/${g.id}/odds/100/propBets?limit=1000`, propBets(g));
  }
  // The seeded Sevilla game (401882878) replays as "under way": the settle pass that every generation
  // runs first must leave its seeded pending tickets alone instead of asking the real ESPN.
  const sevilla = { id: "sev", abbreviation: "SEV", displayName: "Sevilla", shortDisplayName: "Sevilla", name: "Sevilla" };
  const valencia = { id: "val", abbreviation: "VAL", displayName: "Valencia", shortDisplayName: "Valencia", name: "Valencia" };
  writeFile(dir, `${SITE}/soccer/esp.1/summary?event=401882878`, {
    header: { competitions: [{ date: "2026-09-11T19:00Z", status: { displayClock: "55'", period: 2, type: { state: "in", completed: false, shortDetail: "55'", detail: "In Progress" } }, competitors: [
      { id: "sev", homeAway: "home", score: "1", team: sevilla }, { id: "val", homeAway: "away", score: "1", team: valencia },
    ] }] },
    boxscore: { teams: [], players: [] }, rosters: [],
  });
  for (const day of ["20260911"]) {
    writeFile(dir, `${SITE}/soccer/esp.1/scoreboard?dates=${day}&limit=100`, { leagues: [{ calendar: [] }], events: [] });
    writeFile(dir, `${SITE}/soccer/esp.1/scoreboard?dates=${day}&limit=1`, { leagues: [{ calendar: [] }], events: [] });
  }
  writeFile(dir, `${SITE}/soccer/esp.1/teams/sev/roster`, { athletes: [] });
  writeFile(dir, `${SITE}/soccer/esp.1/teams/val/roster`, { athletes: [] });

  // signals/environment.ts derives the season from the TIP-OFF, so a world built on New Year's Eve
  // can be asked for either side of the boundary; both are written rather than left to the network.
  const SEASONS = [...new Set(games.map((g) => g.startsAt.getUTCFullYear()).concat(new Date(now).getUTCFullYear()))];

  const leagueOf = (t: Team) => (t.players[0].id.startsWith("88") ? { sport: "soccer", league: "bra.1" } : { sport: "basketball", league: "wnba" });
  for (const t of teams) {
    const { sport, league } = leagueOf(t);
    writeFile(dir, `${SITE}/${sport}/${league}/teams/${t.id}/roster`, { athletes: t.players.map((p) => ({ id: p.id, displayName: p.name, position: { abbreviation: p.pos } })) });
    writeFile(dir, `${SITE}/${sport}/${league}/teams/${t.id}/schedule?season=2026`, { events: [] });
    for (const p of t.players) {
      const log = gamelog(p, t.id, sport as FakeGame["sport"], now);
      writeFile(dir, `${COMMON}/${sport}/${league}/athletes/${p.id}/gamelog`, log);
      writeFile(dir, `${COMMON}/${sport}/${league}/athletes/${p.id}/gamelog?season=${new Date(now).getUTCFullYear() - 1}`, { labels: [], events: {}, seasonTypes: [] });
      const starts = p.id === "88003" ? "3 (6)" : p.id === "88002" ? "8 (2)" : "9 (1)";
      writeFile(dir, `${WEB}/${sport}/${league}/athletes/${p.id}`, { athlete: { displayName: p.name, position: { abbreviation: p.pos }, team: { id: t.id, abbreviation: t.abbr }, statsSummary: { displayName: "2026", statistics: [{ name: "starts-subIns", displayValue: starts }] } } });
      // Season splits, basketball only (signals/splits.ts never asks for any other group). Without
      // these the closed world would let a generation reach the real ESPN for every candidate.
      if (sport === "basketball") for (const season of SEASONS) writeFile(dir, `${WEB}/${sport}/${league}/athletes/${p.id}/splits?season=${season}`, athleteSplits(p, teams.filter((x) => x.id !== t.id && !x.players[0].id.startsWith("88")), season));
    }
    if (sport === "basketball") {
      for (const season of SEASONS) writeFile(dir, `${CORE}/${sport}/leagues/${league}/seasons/${season}/types/2/teams/${t.id}/statistics`, teamSeasonStats(t, teams.indexOf(t), season));
    }
  }

  // The custom parlay solves over today's upcoming games and the cross-game slate needs at least
  // two of them, so the world has to hold that at any hour. Said here, where it is one line to fix,
  // rather than left to surface as two specs failing on whoever runs them after dinner.
  const open = games.filter((g) => g.league === "wnba" && g.day === 0 && g.state === "pre" && g.startsAt.getTime() > now && g.props?.length);
  if (open.length < 3) throw new Error(`fake ESPN: today's WNBA slate has ${open.length} upcoming games with props, the specs need 3`);
  return { games };
}
