/**
 * Destaques do dia: which few games get tickets without anyone opening them, so the public record,
 * the landing and the digest are never empty. Pure and tested; the job feeds it the slate.
 */
export const DEFAULT_FEATURED_SPORTS = ["soccer-bra", "wnba", "soccer-eng", "soccer-ucl", "soccer-lib"];
export const FEATURED_MAX = 8;

export interface FeaturedConfig { perDay: number; sports: string[] }

export function featuredConfig(env: Record<string, string | undefined>, known: string[]): FeaturedConfig {
  const raw = Number(env.FEATURED_PER_DAY);
  const perDay = Number.isFinite(raw) && env.FEATURED_PER_DAY?.trim() !== "" && env.FEATURED_PER_DAY !== undefined ? Math.max(0, Math.min(FEATURED_MAX, Math.floor(raw))) : 3;
  const listed = (env.FEATURED_SPORTS ?? "").split(",").map((s) => s.trim()).filter((s) => known.includes(s));
  return { perDay, sports: listed.length ? listed : DEFAULT_FEATURED_SPORTS.filter((s) => known.includes(s)) };
}

export interface FeaturedCandidate {
  gameId: string;
  sportKey: string;
  startsAt: string;
  teamIds: string[];
  /** The scoreboard already carries a book line: the generation will have prices to work with. */
  hasLines: boolean;
}

export const FEATURED_WINDOW = { minHours: 2, maxHours: 30 };

/**
 * Ranking: how many people follow either team (or the league), then league priority (the order of
 * the configured sports — Brasileirão first for a Portuguese audience), then whether lines exist,
 * then kickoff. Only games starting 2–30 hours from now qualify.
 */
export function pickFeatured(
  games: FeaturedCandidate[],
  follows: { teams: Map<string, number>; leagues: Map<string, number> },
  cfg: FeaturedConfig,
  now = Date.now(),
): FeaturedCandidate[] {
  const hour = 3_600_000;
  const score = (g: FeaturedCandidate) =>
    g.teamIds.reduce((n, id) => n + (follows.teams.get(`${g.sportKey}:${id}`) ?? 0), 0) + (follows.leagues.get(g.sportKey) ?? 0);
  const priority = (g: FeaturedCandidate) => cfg.sports.indexOf(g.sportKey);
  const seen = new Set<string>();
  return games
    .filter((g) => {
      const t = Date.parse(g.startsAt);
      if (!cfg.sports.includes(g.sportKey) || !Number.isFinite(t) || seen.has(g.gameId)) return false;
      seen.add(g.gameId);
      return t - now >= FEATURED_WINDOW.minHours * hour && t - now <= FEATURED_WINDOW.maxHours * hour;
    })
    .sort((a, b) =>
      score(b) - score(a) ||
      priority(a) - priority(b) ||
      Number(b.hasLines) - Number(a.hasLines) ||
      a.startsAt.localeCompare(b.startsAt))
    .slice(0, cfg.perDay);
}
