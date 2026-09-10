# NBA Edge

A local research desk for NBA betting. Pick a day, click a game, and the app gathers everything
about that matchup into one page: the market, the injury report, what the insiders you follow on X
just posted, the rows from your PropsCash account, the picks from Mama Knows Bets, the Dimers model
projections and best bets, and an AI brief that reconciles all of it.

None of it is advice. It is a faster way to look at the same data you were going to open eight tabs
for.

## Setup

```bash
pnpm install
pnpm browsers:install          # one-time Chromium download for Playwright
cp .env.local.example .env.local   # then paste your ANTHROPIC_API_KEY
pnpm dev                       # http://localhost:3000
```

### Log in to the sources

PropsCash, Mama Knows Bets and X have no public API, so the app drives a real browser using a
session you create once by hand:

```bash
pnpm login x
pnpm login propscash
pnpm login mamaknowsbets
```

Dimers is free, so it needs no session — it is configured with `"requiresLogin": false` and scrapes
straight away. Any source you add can do the same.

Each opens a Chromium window. Log in however you normally would — password, 2FA, captcha, SSO —
then press Enter in the terminal. Cookies land in `.sessions/<site>.json` and every scrape reuses
them until the site expires them.

Check status any time:

```bash
pnpm sessions
```

The dots in the app header show the same thing.

## Pointing it at the right pages

Everything site-specific lives in [`config/sources.json`](config/sources.json) — no code changes
needed.

- **`x.insiders`** — the accounts to read. Replace the starter list with yours. Handles only, no `@`.
- **`x.lookbackHours`** — how far back to read (default 36).
- **`propscash.targetUrl` / `mamaknowsbets.targetUrl`** — the page holding the data. Templates
  support `{team}`, `{opponent}`, `{date}` and `{gameId}`, URL-encoded on substitution. If the tool
  has a per-matchup URL, use it; if it only has one big slate page, leave it and the extractor will
  filter to the matchup.
- **`extractionHint`** — plain-English description of what to pull. This is the actual extraction
  prompt, so it is the first thing to tune if a source comes back thin.
- **`useVision`** — also send a screenshot to the model. Off by default; turn it on for pages whose
  numbers live in canvas or images rather than text.

## How the scraping works

Sites without an API get read three ways at once, and the model sees all three:

1. **Network JSON** — every JSON response the page's own frontend fetched is captured. This is the
   closest thing to a real API these tools have, and it is usually where the clean numbers are.
2. **Serialised tables** — any `<table>` flattened to TSV, so row/column structure survives.
3. **Rendered text** — `innerText` of the loaded, scrolled page.

Consent banners and analytics SDKs are filtered out before any of that reaches the model. On the
Dimers page they accounted for 249KB of the 306KB captured — left in, they would have crowded the
real data out of the token budget. First-party API responses are ranked ahead of third-party ones
for the same reason.

Claude then extracts against a strict schema. The prompt forbids inventing numbers: if the page
shows a login wall or no rows, the source comes back `empty` with the reason rather than a
plausible-looking table.

## Layout

```
src/lib/sources/espn.ts       schedule, odds, injuries, team stats  (public, no auth)
src/lib/sources/x.ts          insider timeline scrape + AI relevance triage
src/lib/sources/scraped.ts    PropsCash, Mama Knows Bets and Dimers via generic page capture
src/lib/browser/session.ts    Playwright session reuse and page capture
src/lib/ai/extract.ts         Claude structured-output extraction
src/lib/intel.ts              per-game aggregation + synthesis brief (streams as sources land)
src/app/                      dashboard, game page, API routes
```

The game page opens a streaming NDJSON request, so each source appears the moment it finishes
instead of blocking on the slowest one. Results are cached on disk (`.cache/`) for 8–15 minutes;
"refresh" forces a re-fetch.

## Adding another source

`fetchProps` / `fetchPicks` are generic over the site key, so a new source is a `config/sources.json`
entry, a `SiteKey` union member, and one line in `gatherIntel`/`streamIntel`. Dimers was added that
way after the fact.

## Notes

- The NBA has a four-month offseason. On an empty date the dashboard automatically shows the nearest
  slate that has games and tells you it did.
- Scrapes take real time — a full gather launches a browser session per source.
- **Playwright is pinned to 1.55.0 on purpose.** 1.56+ dropped Chromium builds for macOS 13
  (Ventura), which this machine runs. Do not bump it without checking `npx playwright install`.
- `.sessions/` holds live login cookies. It is gitignored; keep it that way.
- Betting markets are efficient and these tools disagree with each other constantly. Treat every
  number as a starting point to verify, not a conclusion.
