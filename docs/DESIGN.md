# Betmatic — Design System: *Mesa de Operações*

Status: specification. Written 2026-09-18 on `feat/design-system`, before any product code changed.
Audience: whoever rebuilds the surfaces listed in §15. Every number here is a decision, not a default.

---

## 1. The thesis, in three sentences

Betmatic is an instrument, not a tipster site: the screen's job is to put a price, a measured
chance and the evidence behind them next to each other so a person can decide in two seconds and
keep deciding for an hour without fatigue. Therefore the interface is a dark, ruled, tabular
workspace where type and alignment carry the hierarchy, and colour is spent only on meaning —
settled win, settled loss, caution, and the keyboard's position — never on decoration. The
marketing pages are the same system at a lower density: same ramp, same rules, same numerals,
more air and a longer measure, so that a visitor who converts recognises the product they were
promised.

---

## 2. What we are correcting (from the audit, with evidence)

Screens captured 2026-09-18 from a production build (`next start`, seeded `data/design`) at
1440×900 and 390×844, 2× DPR. Files live in the session scratchpad under `design/betmatic/`.
These are the specific reasons the current UI reads as junior / machine-made:

**Colour has no rule.** In one header (`1440-app-slate.png`) there are four accent hues at once:
green logo + green `NOVO` badge + green live dot, a **cyan** `BR/EN` toggle, an **amber** `admin`
label, and a **cyan** primary button on the tour card. The landing's primary button is green
(`bg-edge-400`); the admin's primary button is cyan (`Rodar refresh agora`); the tour's is cyan.
Two different "primary" colours ship in the same product. Meanwhile green is simultaneously the
brand, the CTA, the link arrow, the bullet dash, the ladder bars and "won" — so green means
nothing.

**The main workspace has almost no data on it.** `/app` at 1440×900 shows three cards and roughly
55 % of the viewport is empty black below them. A tool a professional uses all day opens with the
slate, not with three tiles and a void.

**Density is accidental, not chosen.** `/app` uses a 28 px page title and a 16 px grey sentence
before any data; on 390 px that costs ~250 px of an 844 px viewport, so exactly one game fits
above the fold (`390-app-slate.png`). Font sizes across the codebase are arbitrary half-pixels —
`text-[13.5px]`, `text-[12.5px]`, `text-[11.5px]`, `text-[10px]` — i.e. there is no scale.

**Everything is the same box.** Panels, plan cards, FAQ cells, the ladder, the KPI strips: all
`rounded-xl`/`rounded-2xl`, all `border-ink-800`, all `bg-ink-900/60`. Nothing is heavier than
anything else, so nothing reads as primary. The landing is ten stacked `py-16 max-w-6xl` sections
with the same H2 size in each — no dynamic range from top to bottom.

**Native controls are shipped raw.** `/app/parlays/custom` renders two `<input type=range>` in the
same form: one picks up `accent-color` green, the other renders in **macOS system blue**. The date
control on `/app` is a bare `<input type=date>` with the OS calendar glyph and OS metrics sitting
inside an otherwise designed header. Selects show the platform chevron at four different widths in
the bankroll filter row.

**Tables exist as headers without tables.** `/admin` renders the column header row
`ORIGEM · VISITANTES · CADASTROS · ABRIU JOGO · SALVOU · PAGOU` with zero rows and no empty state,
so six labels hang in space at content-driven positions. The same view's KPI grid is 6 columns
holding 11 tiles, leaving one visibly empty cell.

**Charts are not designed.** The bankroll equity curve is a 3–4 px amber polyline over four points
with no axes, no gridlines, no y-scale beyond a floating `+1.00u`, no x labels, and dots coloured
green or amber with no stated rule. Amber is used for the line regardless of direction, and
separately for negative ROI — while another negative in the same KPI row (`−1.74u`) is white.

**Numbers are not localised consistently.** `R$ 0,00` (comma) sits beside `0.0%` and `50.0%` (dot)
on pt-BR pages; `/admin` shows `R$ 0` next to `$0.00` and `$20.00` in one view. `+R$ 0,00` puts a
plus sign on zero.

**Overflow was never designed.** The "what's new" strip clips mid-word at both 1440 (`Múltipla sob
me…`, `você diz quanto q…`) and 390 (`jogador no banco vira sel…`). The first-visit tour is an
unanchored floating card that covers the second game card on mobile and overlaps the footer on
desktop.

**Measure is unbounded.** `/prova` runs prose at ~95 characters per line; `/app/parlays/custom`
runs the intro at ~90. There is no `max-width` on body copy anywhere.

**Full-colour third-party crests** (ESPN team logos) are dropped into a monochrome UI and become
the loudest thing on the screen.

---

## 3. Typefaces

Three families, self-hosted by `next/font/google` (no external stylesheet, no CDN, `display:
swap`, `latin` + `latin-ext` subsets so Portuguese diacritics are in the same file as the Latin
core and never fall back mid-word). Axes and weights below were verified against
`next/dist/compiled/@next/font/dist/google/font-data.json` in this repo — they are what the
installed Next can actually build.

### 3.1 Display / voice — **Archivo** (variable: `wght` 100–900, `wdth` 62–125)

Omnibus-Type's industrial grotesque, drawn for signage and high-performance printing. Three reasons:
(a) the **width axis is the identity move** — a hero at `wdth 112` and a condensed table header at
`wdth 82` are the *same* voice at two densities, which is exactly the range this product spans;
(b) its numerals are squarish and flat-sided, so `50,0 %` at 39 px on `/prova` reads like an
instrument readout rather than a marketing number; (c) it is a Latin-American foundry face with
full Portuguese coverage, a better fit for a pt-BR-first product than another American UI sans —
and it is none of the four banned headline faces.

```
Archivo   variable, wght 400–700, wdth 82 (condensed) · 100 (default) · 112 (display)
next/font: Archivo({ subsets: ["latin","latin-ext"], axes: ["wdth"] })
fallback:  "Archivo Fallback", "Helvetica Neue", Arial, sans-serif
```

Used for: `h1`–`h3`, page titles, section titles, the wordmark, KPI values above 24 px, table
column headers (at `wdth 82`, 500). Nothing below 11 px.

### 3.2 Text / UI — **IBM Plex Sans** (variable: `wght` 100–700, `wdth` 75–100)

Drawn by Bold Monday for interfaces where a misread character is a defect, which is the condition
here: `1` vs `l`, `0` vs `O`, and a disambiguated `rn`/`m` matter when the string is `MIN −6.5` or
`IND −14.5`. Its x-height stays legible at the 12 px this product needs in table cells, and its
accents are drawn tight enough that `ç`, `ã`, `õ`, `é` do not collide with the line above at 1.3
leading. It also carries a `wdth` axis of its own — so the `compact` density can narrow body text
to `wdth 92` in table cells without changing family, and dense rows gain roughly 6 % more
characters per column for free.

```
IBM Plex Sans   variable, wght 400–600, wdth 92 (compact cells) · 100 (everything else)
next/font: IBM_Plex_Sans({ subsets: ["latin","latin-ext"], axes: ["wdth"] })
fallback:  "IBM Plex Sans Fallback", -apple-system, "Segoe UI", Roboto, sans-serif
```

Used for: all body copy, labels, buttons, form fields, navigation, microcopy, legal text.

### 3.3 Numerals / code — **IBM Plex Mono** (static: 400 / 500 / 600)

Same skeleton, same foundry, same vertical metrics as Plex Sans — which is the whole argument. When
a row reads `Sevilha ou empate` (Plex Sans) `1,26` (Plex Mono) the two halves sit on the same
baseline with the same colour of grey and the same apparent weight. A mono from another family
(the current `Geist Mono` next to `Geist Sans`) always looks pasted in.

```
IBM Plex Mono   400 / 500 / 600   (no variable build on Google Fonts — three static weights)
next/font: IBM_Plex_Mono({ subsets: ["latin","latin-ext"], weight: ["400","500","600"] })
fallback:  "IBM Plex Mono Fallback", ui-monospace, SFMono-Regular, "Roboto Mono", monospace
```

Used for: **every number a person compares to another number** — odds, decimal multipliers, implied
and measured chance, stake, profit, ROI, units, drawdown, scores, dates in tables, coin balances,
UTM strings, IDs, env keys. Never for prose.

### 3.4 Rules

- `font-variant-numeric: tabular-nums` on every Plex Mono run and on Archivo when it sets a KPI in
  a row of KPIs. `slashed-zero` on Plex Mono everywhere (IDs and odds are read aloud on support
  calls).
- Fallback metric overrides are generated by `next/font` (`adjustFontFallback: true`) so there is no
  layout shift on first paint. Verify by loading with `Network: offline` after a hard reload.
- **Subsets, corrected by measurement (wave 0).** The claim above — that `latin-ext` is what keeps
  Portuguese diacritics from falling back — is wrong: `ã õ ç é â ê ô ú í` all live in the `latin`
  subset (U+00C0–00FF). `latin-ext` buys the Eastern-European and Turkish letters that appear in
  feed names (`Šahtar`, `İstanbul`, `Łódź`). So only **Plex Sans**, the face that sets every team and
  player string, carries `latin-ext`; Archivo (our own headings) and Plex Mono (figures and
  three-letter abbreviations) carry `latin` alone. Measured in a browser against the production
  build: **217.2 KB of woff2 over six files** on both `/` and `/design`, versus 327 KB with
  `latin-ext` on all three. The residual risk is a display-size heading containing an Eastern-
  European name, which falls back for that glyph; the fix, if it ever shows, is `latin-ext` on
  Archivo for 84 KB.
- **Never** set Archivo below 11 px, never set Plex Mono above 32 px, never set prose in Plex Mono.
- The banned headline faces — Inter, Poppins, Montserrat, Geist — appear nowhere, including in
  fallback stacks (system fallbacks only).

---

## 4. Type scale

Two registers, one ratio. Below 16 px the steps are hand-set for legibility at small sizes (a
mathematical ratio produces useless 13.4 px steps); from 16 px up the ratio is **1.25** (major
third), rounded to whole pixels.

| Token | px / rem | Line-height | Tracking | Family / weight | Used for |
|---|---|---|---|---|---|
| `text-micro` | 10 / 0.625 | 12 (1.2) | +0.08em | Plex Sans 500, uppercase | axis ticks, footnote markers |
| `text-label` | 11 / 0.6875 | 14 (1.27) | +0.06em | Archivo 500 `wdth 82`, uppercase | column headers, KPI labels, chips |
| `text-tiny` | 12 / 0.75 | 16 (1.33) | 0 | Plex Sans 400 | dense table cells, legal, captions |
| `text-sm` | 13 / 0.8125 | 18 (1.38) | 0 | Plex Sans 400/500 | default UI text, nav, form labels |
| `text-base` | 14 / 0.875 | 21 (1.5) | 0 | Plex Sans 400 | app body, panel prose |
| `text-body` | 16 / 1 | 26 (1.625) | 0 | Plex Sans 400 | marketing prose, legal pages |
| `text-lead` | 20 / 1.25 | 29 (1.45) | −0.005em | Plex Sans 400 | marketing deck / sub-headline |
| `text-h3` | 25 / 1.5625 | 30 (1.2) | −0.015em | Archivo 600 `wdth 100` | panel group titles, plan names |
| `text-h2` | 31 / 1.9375 | 36 (1.16) | −0.02em | Archivo 600 `wdth 104` | section titles |
| `text-h1` | 39 / 2.4375 | 42 (1.08) | −0.025em | Archivo 600 `wdth 108` | page titles (marketing) |
| `text-display` | 49 / 3.0625 | 51 (1.04) | −0.03em | Archivo 700 `wdth 112` | hero |
| `text-mega` | 61 / 3.8125 | 61 (1.0) | −0.035em | Archivo 700 `wdth 112` | one hero per site, ≥1024 px only |

Numeric display sizes (Plex Mono 500, tabular, tracking −0.01em): **14 / 16 / 20 / 25 / 31**. A KPI
value never exceeds 31 px; the hero ladder is the only place a number is set larger, and it uses
Archivo, not mono.

**Fluid steps.** Only `text-display` and `text-mega` are fluid:
`clamp(2.4375rem, 1.6rem + 3.6vw, 3.8125rem)`. Everything else is fixed, because a table cell that
changes size with the viewport cannot be compared across screenshots.

**The 12 px floor.** Below 768 px nothing is set under 12 px: `text-micro` (10) and `text-label`
(11) rise to 12 and meet `text-tiny` there. The step is then carried by something other than size —
a label by case and tracking (`u-label`), a footnote or an axis tick (`text-micro`) by weight 500, a
caption (`text-tiny`) by neither. Every other size is fixed at every width. SVG text follows the
same floor: a chart's viewBox is the width it is drawn at, so 12 in the drawing is 12 on the screen.

**Measure.** Prose is capped at `65ch` (marketing) and `72ch` (legal pages, which are read in long
runs). Panel prose inside the app is capped at `58ch`. No text block is ever full-bleed.

**Optical details.**
- Hanging punctuation on pull-quotes and the honesty statements: `hanging-punctuation: first;`
  with a `-0.4em` text-indent fallback on the one component that uses it.
- Uppercase labels always carry positive tracking (see table); lowercase never does.
- Baselines align between a label and its value: a KPI label sits on the 4 px grid and the value's
  cap-height starts exactly 8 px below the label's baseline (`--kpi-gap: 8px`), so a row of KPIs
  scans as a line, not as five separate boxes.

---

## 5. Grid, spacing, rhythm

### 5.1 Spacing scale (4 px base, named, no arbitrary values)

```
--s-0   0      --s-1   2px    --s-2   4px    --s-3   6px    --s-4   8px
--s-5   12px   --s-6   16px   --s-7   20px   --s-8   24px   --s-9   32px
--s-10  40px   --s-11  56px   --s-12  72px   --s-13  96px   --s-14  128px
```

Rules: inside a control, only `--s-1…--s-5`. Between elements of a group, `--s-4`/`--s-5`. Between
groups in a panel, `--s-8`. Between panels, `--s-6` (app) or `--s-9` (marketing). Between marketing
sections, `--s-12` at ≥1024 px, `--s-10` below. **Vertical rhythm is 4 px**; every block's height
and every margin resolves to a multiple of 4.

### 5.2 The app shell — a real grid, not a stack of cards

```
┌──────────────────────────────────────────────────────────────────────────┐
│ topbar 48px  — logo · context (sport/date) · search · account · balance  │
├────────────┬────────────────────────────────────────┬────────────────────┤
│ rail 224px │ work column  (min 0, fr)               │ dock 320px         │
│ collapsed  │ tables, game pages, forms              │ slip / live / meta │
│ 56px       │                                        │ (hidden < 1280px)  │
└────────────┴────────────────────────────────────────┴────────────────────┘
```

- The **rail** replaces today's five visible links + hamburger: all 13 destinations are visible at
  ≥1024 px, grouped `Mesa · Pesquisa · Banca · Conta`, with the active item marked by a 2 px
  left bar in `--focus` plus `--text-primary` (two cues, not colour alone). Collapses to 56 px
  icons at 1024–1279 px; becomes a bottom tab bar (5 items) + sheet on < 768 px.
- The **work column** is the only scrolling region on desktop; the topbar and rail are fixed. Its
  content grid is **12 columns, 16 px gutter, no outer max-width** — data fills the monitor. Prose
  inside it is still capped at 58ch.
- The **dock** holds what must stay visible while you work the slate: the current slip, the live
  panel, the day's budget. It is a peer of the work column, not a modal.
- Page padding: `--s-6` (16) at <768, `--s-7` (20) at ≥768, `--s-8` (24) at ≥1440. Never a
  `padding` shorthand that zeroes the sides.

### 5.3 The marketing grid — intentional asymmetry

12 columns, 24 px gutter, content max **1240 px**, page gutter `--s-6`/`--s-8`. Sections do **not**
all use the same split. The allowed splits, and each is used at most twice per page:

| Split | Columns | Use |
|---|---|---|
| A | 7 / 5 | hero: argument left, live artefact right |
| B | 4 / 8 | a claim in the narrow column, its evidence table in the wide one |
| C | 5 / 7 offset by 1 | the honesty section — text indented, so the page breathes differently once |
| D | 12 full-bleed | one ruled table (the ladder, the track record) edge to edge |
| E | 6 / 6 | exactly one comparison; never used for "three feature cards" |

A section title sits in column 1 and never repeats the size of the previous section's title: the
page steps **display → h1 → h2 → h2 → h3**, top to bottom, so scroll depth is legible from type
size alone.

---

## 6. Colour

### 6.1 Principles

1. **One achromatic action colour.** The primary button is ink-on-paper (near-white on dark,
   near-black on light). It is the highest-contrast thing on the screen and it is not a hue, so it
   never competes with data.
2. **Hue is reserved for meaning.** Green = settled win / positive delta. Red = settled loss /
   negative delta. Amber = caution and responsible-gambling notices. Blue = **focus and selection
   only** — it appears exactly where the keyboard is and on the current nav item, nowhere else.
3. **The brand carries no hue.** The mark and wordmark are set in `--text-primary`. This is also a
   compliance decision: a green brand on a betting product implies profit, and Brazilian betting
   advertising rules forbid promising it.
4. Colour is never the only carrier: every win/loss is also a word or a sign (`+`/`−`), every
   selected state also has a border or bar, every focus ring is a ring, not a tint.

### 6.2 Neutral ramp (cool graphite, hue ≈ 222)

```
n0   #FFFFFF   n25  #FAFBFC   n50  #F2F4F7   n100 #E6E9EF   n200 #CFD4DE
n300 #AEB5C2   n400 #868EA0   n500 #676F81   n600 #4E5566   n700 #3A4050
n800 #2A2F3C   n850 #20242E   n900 #171A22   n950 #10131A   n1000 #0A0C11
```

### 6.3 Dark theme (default) — measured contrast

Backgrounds: `surface-0 #0A0C11` (page) · `surface-1 #10131A` (panel) · `surface-2 #171A22`
(row hover / raised) · `surface-3 #20242E` (input, pressed).

| Token | Hex | vs surface-0 | vs surface-1 | vs surface-3 | Verdict |
|---|---|---|---|---|---|
| `text-primary` | `#EDF0F5` | 17.12 | 16.27 | 13.59 | AAA |
| `text-secondary` | `#AEB5C2` | 9.49 | 9.02 | 7.53 | AAA |
| `text-tertiary` | `#868EA0` | 5.95 | 5.65 | 4.72 | AA at every size |
| `text-disabled` | `#676F81` | 3.88 | 3.69 | 3.08 | exempt (disabled), still ≥3:1 |
| `pos` (win/up) | `#3ED598` | 10.41 | 9.89 | 8.26 | AAA |
| `neg` (loss/down) | `#FF6B70` | 7.07 | 6.72 | 5.61 | AAA/AA |
| `warn` | `#F2B441` | 10.60 | 10.07 | 8.41 | AAA |
| `focus` | `#6AA6FF` | 7.93 | 7.53 | 6.29 | AAA, ≥3:1 as a ring |
| `border-control` | `#676F81` | 3.88 | 3.69 | 3.08 | ≥3:1 — input/button edges |
| `border-strong` | `#3A4050` | 1.89 | — | — | structural only, never sole affordance |
| `border` | `#2A2F3C` | 1.46 | — | — | table rules, panel edges |

Tints (state backgrounds, 14 % of the hue over `surface-1`): `pos-tint #162E2C` (pos text on it:
7.65), `neg-tint #311F26` (neg text on it: 5.60).

Action: `action-bg #EDF0F5` / `action-fg #0A0C11` → **17.12**. Solid `pos` chip: `#0A0C11` on
`#3ED598` → 10.41. Solid `neg` chip: `#0A0C11` on `#FF6B70` → 7.07.

### 6.4 Light theme — first-class, measured

Light is not an afterthought: `/prova`, the legal pages, the weekly report and anything printed
default to it, and the app honours the OS setting. Backgrounds: `surface-0 #FFFFFF` ·
`surface-1 #FAFBFC` · `surface-2 #F2F4F7`.

| Token | Hex | vs #FFFFFF | vs #F2F4F7 | Verdict |
|---|---|---|---|---|
| `text-primary` | `#10131A` | 18.58 | 16.86 | AAA |
| `text-secondary` | `#4E5566` | 7.46 | 6.77 | AAA |
| `text-tertiary` | `#676F81` | 5.04 | 4.57 | AA |
| `text-disabled` | `#868EA0` | 3.29 | 2.98 | exempt (disabled) |
| `pos` | `#0E7C52` | 5.22 | 4.74 | AA |
| `neg` | `#C0303A` | 5.64 | 5.12 | AA |
| `warn` | `#8A5A00` | 5.93 | 5.38 | AA |
| `focus` | `#1B62D6` | 5.58 | 5.06 | AA, ≥3:1 as a ring |
| `border-control` | `#7E8798` | 3.62 | 3.28 | ≥3:1 |
| `border` | `#E6E9EF` | 1.22 | 1.17 | rules only |

Action: `#FFFFFF` on `#10131A` → **18.58**.

Theme wiring: the full light palette is defined on bare `:root`; dark overrides live in
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` and again in
`:root[data-theme="dark"] { … }`, so an explicit toggle wins in both directions. No colour is ever
defined *only* inside a media query.

### 6.5 The one sequential ramp

Implied/measured chance is the only column that gets a ramp, and it is **not applied to the text**
— the number stays `text-primary` so it is always readable. The ramp paints a 2 px rule on the
cell's leading edge, stepped at 50 / 20 / 5 / 1 %:

```
≥50%  #AEB5C2   20–50%  #E8C36B   5–20%  #F2A541   1–5%  #F2785C   <1%  #FF6B70
```

The percentage is always printed next to the multiplier — required by Brazilian advertising rules
and, separately, the whole point of the product.

### 6.6 Team crests

Third-party crests are rendered at 16 px inside a `--s-2` neutral well, desaturated to 55 % with
`filter: saturate(.55)`, and they sit *after* the team name in the DOM so the name is the anchor.
On dense tables they are omitted entirely and the three-letter abbreviation in Plex Mono is used.

---

## 7. Density is a decision

Three density modes, one system. Density changes row height, padding and the leading of small text
— never the type scale or the palette.

| Token | `compact` | `default` | `comfortable` |
|---|---|---|---|
| `--row-h` | 28px | 32px | 40px |
| `--cell-px` | 8px | 12px | 16px |
| `--panel-p` | 12px | 16px | 24px |
| `--stack-gap` | 8px | 12px | 16px |
| body size | `text-tiny` 12 | `text-sm` 13 | `text-base` 14 |

- `compact` — the slate table, the ledger, the admin tables, the CLV list. The default for any
  screen whose job is comparison.
- `default` — game pages, forms, the dock, settings.
- `comfortable` — every marketing page, legal pages, onboarding, empty states.

Density is a `data-density` attribute on the shell, persisted per viewer. Below 768 px every mode
resolves to one **phone density**: `--row-h` 44, `--cell-px` 16, `--panel-p` 20, `--stack-gap` 16,
body 14 — a control drawn at the row height is a fingertip's target, and the type does not grow
with the row.

---

## 8. Radius, borders, surfaces, elevation

### 8.1 Radius — square by default

```
--r-0  0      table cells, rows, the ledger, the slate, section dividers, full-bleed strips
--r-1  2px    inputs, selects, buttons, chips, badges, tabs
--r-2  4px    panels, popovers, dialogs, the dock
--r-3  8px    only: the first-visit tour card and the mobile sheet
--r-full      only: the live dot, avatars, the drag handle
```

Uniform `rounded-2xl` on everything is banned. If two adjacent elements have the same radius and
the same border, one of them is wrong.

### 8.2 Borders — one hairline, honestly rendered

A 1 px border on a 2× display renders as 0.5 device pixels and goes muddy. Rules:

- Panel and control edges use `1px solid var(--border)`. Table rules use
  `box-shadow: inset 0 -1px 0 var(--border)` on the row, never `border-bottom` on cells, so a
  sticky header and a scrolled body cannot double the line.
- On `min-resolution: 2dppx` the rule colour is lightened one step (`--border` → `#2F3542` dark,
  `#EDEFF3` light) so the line reads the same weight at both densities.
- Interactive edges (input, button, select, chip) use `--border-control` (≥3:1 measured in §6) —
  never `--border`, because the edge *is* the affordance.
- No `border` anywhere that a `box-shadow: inset` rule would do the job, and never two borders
  meeting (use `-1px` margin collapse or a divider parent).

### 8.3 Surfaces and depth — light, not shadow

Depth comes from **surface value + one hairline**, in this order: `surface-0` page → `surface-1`
panel → `surface-2` raised row / hover → `surface-3` input well. Shadows exist only for things that
genuinely float above the document plane and can be dismissed:

```
--elev-pop:    0 1px 2px rgb(0 0 0 / .32), 0 8px 24px rgb(0 0 0 / .36)   popover, dropdown, tooltip
--elev-dialog: 0 2px 4px rgb(0 0 0 / .36), 0 24px 64px rgb(0 0 0 / .48)  dialog, sheet
```

That is the complete list. Drop shadows as the only depth cue on a static card are banned;
glassmorphism, backdrop blur over content, decorative gradients and blurred colour blobs are
banned. The one gradient permitted in the whole system is the horizontal fade that marks a
scrollable table's clipped edge (`--surface-1` → transparent, 24 px).

---

## 9. Motion

Short, functional, and never the thing you notice.

```
--dur-1  90ms    state change on a control (hover, press, check)
--dur-2  140ms   popover / dropdown / tooltip enter; row expand
--dur-3  220ms   dialog, sheet, rail collapse
--ease-out    cubic-bezier(.2, .8, .3, 1)     things entering / settling
--ease-in     cubic-bezier(.4, 0, 1, 1)       things leaving
--ease-inout  cubic-bezier(.4, 0, .2, 1)      things moving between two fixed points
```

Rules: only `opacity` and `transform` are animated (never `height`, `width`, `top`, `color`).
Nothing loops except the live indicator, which is a 2 s opacity pulse on a 6 px dot — not a ring
that grows, because a growing ring reflows nothing but reads as an alert. **A changing number never
animates its digits**; when a price moves, the cell flashes its background (`pos-tint`/`neg-tint`)
for `--dur-2` and holds a 2 px leading rule for 3 s, which is how a trader sees a move without
losing the value. Under `prefers-reduced-motion: reduce`, all durations become 1 ms and the live
pulse becomes a static ring; nothing is removed, only stilled.

---

## 10. Icons

No icon package. A single local sprite, `public/icons.svg`, built by hand and referenced with
`<svg><use href="/icons.svg#name"/></svg>` — one HTTP request, cached, tree-shaken by definition
because we only draw what we use.

- **Grid 20×20, stroke 1.5, round cap, round join, no fills, single path where possible.** A 16 px
  optical size is produced by drawing at 20 and scaling — never by shrinking a 24 px icon, which
  thins the stroke below a device pixel.
- Icons inherit `currentColor` and sit on the text baseline via `vertical-align: -0.15em`, not
  flexbox guesswork.
- The initial set (≈22 glyphs, everything the current UI needs): `calendar`, `chevron-down`,
  `chevron-left`, `chevron-right`, `search`, `filter`, `sort`, `check`, `close`, `plus`, `minus`,
  `arrow-up-right`, `arrow-down-right`, `external`, `copy`, `download`, `refresh`, `info`, `alert`,
  `lock`, `user`, `menu`.
- **Emoji are never icons and never bullets.** The flags in the language switch become the strings
  `PT` / `EN` in Archivo `wdth 82`. "AI sparkle" iconography does not exist in this product; the
  model's output is labelled in words (`Gerado pelo modelo`, with the cost and the timestamp).

---

## 11. Data display

This is the part the product lives or dies on.

### 11.1 Tables

- Semantic `<table>` with `<caption class="sr-only">`, `<thead>` sticky at the work column's top,
  `scope` on every header cell. Column widths are set on `<col>`, never on cells.
- **Alignment:** text left; numbers right; a fixed-width leading column (time, crest) centred.
  Column headers take the alignment of their column — a right-aligned number never sits under a
  left-aligned label.
- **Rules, not zebra.** A 1 px inset rule under every row, and a 2 px rule under `<thead>` and above
  a totals row. Zebra striping is used only where a row is taller than 2 lines (the ledger with
  expanded legs), at a 3.7 % luminance step (`#10131A` → `#14171F`, ratio 1.037) — visible, never
  stripey.
- **Row states:** hover `surface-2` (ratio 1.114 vs panel — perceptible, calm), selected = 2 px
  `--focus` leading bar + `surface-2`, focus-visible = the standard ring (§12), settled rows carry a
  `pos`/`neg` leading rule.
- **Group headers** (by league, by day) are `text-label` rows spanning all columns with a
  `surface-2` fill — not a separate table per group.
- **Overflow:** the table is the only element allowed to scroll sideways, inside its own
  `overflow-x:auto` container with the first column `position: sticky` and the edge fade of §8.3.
  The page body never scrolls horizontally at any width.
- Below 768 px a dense table becomes a **definition list per row** (label left, value right, one
  rule between rows), not a horizontally scrolling table.

### 11.2 Numerals

- Plex Mono, `tabular-nums`, `slashed-zero`, right-aligned in columns, decimal-aligned by padding
  to a fixed fraction length (odds always 2 decimals: `1,26` `21,00`).
- **pt-BR formatting is absolute:** comma decimal separator, dot thousands, `R$ 1.234,56`,
  `50,0 %`, `−18,5 %`, `+2,40 u`. `Intl.NumberFormat` with the request locale, one helper, no
  hand-rolled `toFixed` in a component. The current mix of `R$ 0,00` and `0.0%` on the same page is
  a defect this system closes.
- **Signs:** `+` and `−` (U+2212 minus, not a hyphen) are always printed on deltas; zero prints as
  `0,00` with **no** sign. A negative number is `neg` coloured *and* signed; a positive is `pos`
  coloured *and* signed.
- Odds are shown decimal-first (`2,40`) with the implied chance next to it (`41,7 %`), in that
  order, always both — never a multiplier alone.
- "Not priced" is `—` (em dash) in `text-tertiary`, never `- / -`, never `0`.

### 11.3 Charts

The equity curve, the CLV distribution and the acquisition funnel share one chart grammar:

- **Ink first:** 1.5 px series line, `--text-primary` for a neutral series; `pos`/`neg` only when
  the series encodes gain/loss, and then the line is split at the zero crossing rather than painted
  one arbitrary colour.
- **A zero line always** (1 px `--border-strong`, solid), y-axis with 3–5 ticks at round numbers in
  `text-micro`, x-axis labelled at the first, last and any regime change. Gridlines are horizontal
  only, `--border`, 1 px.
- **Points are drawn only when n ≤ 30**; above that the line alone, with a hover crosshair and a
  value readout in the corner (mono, tabular) instead of tooltips that cover the data.
- **Small samples are labelled, not hidden:** below the publication threshold the chart renders at
  40 % opacity behind the sentence `Amostra pequena: N bilhetes decididos` — the honest version of
  today's behaviour.
- Aspect ratio is fixed at 16:6 with a `max-width: 100%`; the chart never grows to 500 px tall for
  four points, as it does today.
- Every chart has a `<table class="sr-only">` twin with the same numbers.

### 11.4 Money, time, identity

- One currency per view. If the admin must show USD model cost and BRL revenue together, they are
  in separate labelled groups with the currency in the column header, never mixed in a row.
- Times are `HH:mm` in the user's zone with the zone abbreviation in `text-micro` once per group;
  full dates as `18/09/2026` in mono inside tables, `18 de setembro de 2026` in prose.
- IDs and hashes are truncated at 8 characters with a copy affordance, never wrapped.

---

## 12. Component inventory

### 12.0 The focus ring (one definition, everywhere)

```css
:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: inherit;
}
```

`--focus` is `#6AA6FF` dark (7.93:1 on `surface-0`, 6.29:1 on `surface-3`) and `#1B62D6` light
(5.58:1 on white) — both clear 3:1 against every surface they can land on. The 2 px offset means
the ring never sits *on* a control's own border, so it reads at 2× as well as 1×. `:focus` without
`-visible` is never styled; `outline: none` appears nowhere in the codebase.

### 12.1 Button

| Variant | Rest | Hover | Active | Focus | Disabled | Loading |
|---|---|---|---|---|---|---|
| `primary` | `action-bg` fill, `action-fg` text, `--r-1`, 32/36/40 px by density | fill → `n100` (dark) / `n800` (light) | `translateY(1px)`, fill one step darker | ring §12.0 | `surface-3` fill, `text-disabled`, `cursor:not-allowed`, `aria-disabled` | label stays, 14 px spinner replaces the icon slot, width frozen, `aria-busy` |
| `secondary` | transparent, 1 px `--border-control`, `text-primary` | `surface-2` fill | `surface-3` fill | ring | border `--border`, `text-disabled` | as above |
| `ghost` | transparent, `text-secondary` | `surface-2`, `text-primary` | `surface-3` | ring | `text-disabled` | as above |
| `danger` | transparent, 1 px `neg`, `neg` text | `neg-tint` fill | `neg-tint` darker | ring | `text-disabled` | as above |

A button never changes width between states. Icon-only buttons are square at `--row-h` and carry an
`aria-label`; on touch they are padded to 44 px with a transparent hit area, not a bigger box.

### 12.2 Input / select / number field

Rest: `surface-3` fill, 1 px `--border-control`, `--r-1`, `text-primary`, 13 px (`default`
density). Placeholder `text-tertiary` — and placeholders never replace labels. Hover: border →
`text-tertiary`. Focus: ring §12.0 *and* border → `--focus`. Invalid: border `neg`, a `neg`
message below in `text-tiny`, `aria-invalid="true"`, `aria-describedby` pointing at the message.
Disabled: `surface-1` fill, `text-disabled`, no border change. Read-only: no fill, no border, mono.

**Numeric fields** are `inputmode="decimal"`, right-aligned, mono, with the unit as a static suffix
inside the field (`R$` prefix, `u` / `%` suffix in `text-tertiary`), never as a floating label.

**Native controls are replaced** where the platform paints them: `select` gets an invisible native
control over a styled trigger with our own `chevron-down`; `input[type=range]` gets a fully styled
track/thumb in both WebKit and Firefox pseudo-elements (never `accent-color`, which is what
produced the two-colour slider defect); `input[type=date]` is replaced by a text input plus our own
calendar popover. `input[type=checkbox]` / `radio` use `appearance: none` plus a drawn mark.

### 12.3 Table (see §11.1) — states

Rest · hover · selected · focus-visible row · expanded · settled-win · settled-loss · pending ·
void · loading (skeleton) · empty · error · filtered-to-nothing. The **skeleton matches the final
layout**: the same number of columns at the same widths, rows of `--row-h`, each cell a
`surface-2` bar at the width of its typical content — not three grey pills.

### 12.4 Empty, loading, error

Every data region ships all three, and they are not prose in a box:

- **Empty** — the region's own frame (table header, chart axes) stays drawn, and one sentence in
  `text-secondary` sits in the body with a single `secondary` action. Example (keep the pt-BR):
  `Nada na banca ainda.` + `Abrir um jogo`.
- **Loading** — skeleton in the final layout, `surface-2` bars, no spinner above 200 ms of content;
  a spinner only inside a button.
- **Error** — `neg` leading rule, what failed in one sentence, what the reader can do, and a
  `Tentar de novo` action. The error code in mono `text-micro` at the end, selectable.
- **Filtered to nothing** is its own state and offers `Limpar filtros`, because it is not empty.

### 12.5 Panel

Header row (`--row-h`, `text-label` title, optional status badge, meta right, actions far right, 1
px rule below) + body (`--panel-p`). Panels do not nest more than one level; a panel inside a panel
becomes a ruled group with a `text-label` header instead.

### 12.6 Badge / chip / status

`--r-1`, `text-label`, 1 px border, 2/6 px padding, height 20 px. Tones: `neutral` (default),
`pos`, `neg`, `warn`, `info` (= `--focus` hue, used only for "selected"/"filter active"). Every
tone carries a word, never colour alone. Selectable chips (markets, leagues) are checkboxes under
the hood with `aria-pressed`; selected = `action-bg` fill + `action-fg` text, which is the same
achromatic logic as the primary button.

### 12.7 Navigation

Rail item: 32 px, icon 16 + label 13, `text-secondary`; hover `surface-2`; **active = 2 px ink
leading bar + `text-primary` + `surface-2`**, `aria-current="page"`. Group label `text-label`,
`text-tertiary`, 24 px tall. Collapsed rail shows the icon with a delayed tooltip (600 ms).
Bottom tab bar (< 768 px): four items — Jogos · Múltiplas · Banca · Conta — and, while a game of
the current sport is being played, that game as a fifth, named by its two abbreviations with the
live dot (two or more: `N ao vivo`, opening the slate). 56 px plus the device's bottom inset, icon
20 + 12 px label, active = 2 px ink rule on the top edge + `text-primary`. The current item is the
same cue on both and it is not a hue: the blue is the keyboard's (§6.1 is read that way since
Appendix D).

### 12.8 Dialog / sheet / popover

Dialog: `--r-2`, `--elev-dialog`, max 560 px, scrim `rgb(0 0 0 / .56)`, focus trapped, `Esc`
closes, focus returns to the trigger. Sheet (mobile): bottom, `--r-3` top corners, drag handle,
same trap. Popover: `--r-2`, `--elev-pop`, anchored with a 8 px offset and a flip, never a fixed
corner. **The first-visit tour is anchored popovers** on the element it describes — the current
floating card that covers the second game card on mobile is replaced.

### 12.9 Form layout

Label above field, 13 px, `text-secondary`, 6 px gap. Help text below field, `text-tiny`,
`text-tertiary`, `aria-describedby`. Fields group into a two-column grid at ≥768 px with
`grid-template-columns: repeat(2, minmax(0,1fr))` and a single-column span for anything long.
Required is marked on the label in words (`obrigatório`), never with a bare asterisk. A form's
submit row is sticky at the bottom of the work column on long forms.

### 12.10 Print

`/prova`, the weekly report and the ledger export have print styles: light theme forced, rail and
dock hidden, tables `break-inside: avoid` per row, the URL and generation timestamp in a running
footer, charts rendered with their `sr-only` table visible instead of the SVG, and the legal
footer on every page. A person who prints their track record must be able to hand it to someone.

---

## 13. Compliance, which is part of the design

Brazilian betting-advertising rules are constraints on the visual system, not a legal afterthought:

- **No promised profit, anywhere, in any state.** No green "up" arrow as decoration, no confetti,
  no streak badges, no "+R$" in a hero. ROI is shown with its sample size attached and in the same
  neutral voice as every other number.
- **Every multiplier prints its real chance next to it** (§11.2). This is enforced by the component:
  the `<Odds>` primitive takes `decimal` and `probability` and refuses to render without both.
- **No urgency.** No countdowns, no "últimas vagas", no scarcity badge, no pulsing CTA.
- **18+ and the responsible-gambling line stay in the footer of every public page**, in
  `text-tiny` / `text-secondary` — legible, not hidden at 3:1.
- The responsible-gambling notice uses `warn`, never `neg`: it is a caution, not an error.

---

## 14. Do / Don't

**Do**
- Let type and alignment carry hierarchy; reach for colour last.
- Set every number in tabular mono, right-aligned, pt-BR formatted.
- Draw the frame of an empty region so the reader can see what will arrive.
- Design hover, focus-visible, active, disabled, loading, empty, error and long-content overflow
  before shipping a component.
- Keep one primary action per view, and make it the only achromatic high-contrast fill on screen.

**Don't** — this list is the brief, quoted, because these are the tells:
- purple-to-blue (or any) decorative gradient
- glassmorphism / backdrop blur over content
- blurred colour blobs
- emoji used as icons or bullets
- a hero that is centred text + two buttons + three equal feature cards
- uniform `rounded-2xl` on everything
- drop shadows as the only depth cue
- stock "AI sparkle" iconography
- copy like "✨ Powered by AI"
- fake dashboards in screenshots
- lorem-style filler

Add to it, from this audit: two different primary colours in one product; native range/date/select
shipped unstyled; a column header row with no table under it; a chart with no axes; half-pixel font
sizes; and `- / -` where an em dash belongs.

---

## 15. Rebuild order

37 route files exist. They are rebuilt in this order, because each wave depends on the one before
it. Nothing in wave 0 is visible to a user, and nothing after wave 1 changes a token.

**Wave 0 — foundations (no visible change on its own)**
1. `src/app/globals.css` — replace the `@theme` block: neutral ramp, semantic tokens for both
   themes, spacing/radius/motion/density tokens, the focus-ring rule, `color-scheme: light dark`.
2. `src/app/layout.tsx` — swap `Geist`/`Geist_Mono` for `Archivo` (with `axes: ["wdth"]`),
   `IBM_Plex_Sans`, `IBM_Plex_Mono`; add the `data-theme` / `data-density` attributes and the
   no-flash inline theme script.
3. `public/icons.svg` — the 22-glyph sprite, plus `src/components/Icon.tsx`.
4. `src/components/ui.tsx` — rewrite as the primitive layer: `Button`, `Input`, `Select`, `Field`,
   `Chip`, `Badge`, `Panel`, `Table` (+`Th`,`Td`,`NumCell`), `KPI`, `Odds`, `Empty`, `Skeleton`,
   `ErrorState`. Everything below consumes these.
5. `src/lib/format.ts` — one pt-BR/en formatter set (money, percent, units, odds, signed deltas,
   dates); delete every local `toFixed`.

**Wave 1 — the shell**
6. `src/app/(app)/layout.tsx` + `src/components/Controls.tsx` — topbar / rail / work column / dock,
   the 13 destinations, the collapsed and mobile variants.
7. `src/components/AccountBar.tsx`, `Logo.tsx` (monochrome mark + wordmark), `LangSwitch.tsx`
   (`PT`/`EN`, no flags), `Tour.tsx` (anchored popovers).

**Wave 2 — the dense screens, in traffic order**
8. `(app)/app` — the slate as a ruled table (today's three floating cards become rows), with the
   date control, filters and the `compact` density.
9. `(app)/app/game/[gameId]` + `GameCard.tsx`, `BetsPanel.tsx`, `ParlayBuilder.tsx` — the ticket
   view: legs, odds + chance pairs, evidence, the `Odds` primitive everywhere.
10. `(app)/app/bankroll` + `BankrollBoard.tsx`, `EquityChart.tsx` — the chart grammar of §11.3, the
    KPI row, the ledger table.
11. `(app)/app/track` + `TrackRecord.tsx`, `ClvBlock.tsx` — the settled ledger.
12. `(app)/app/slip` + `SlipBuilder.tsx`, `DeepSlipTable.tsx`, `SlipScanner.tsx`.
13. `(app)/app/parlays` and `(app)/app/parlays/custom` + `CustomParlay.tsx` — the form of §12.9,
    styled range/select/checkbox, the market chips as a grouped set.
14. `(app)/app/player/[athleteId]` + `PlayerPanels.tsx`, `PlayerChart.tsx`, `PlayerDeepDive.tsx`,
    `PlayerReadCard.tsx`.
15. `(app)/app/tipster` + `TipsterAudit.tsx`, `TipsterReport.tsx`, `TipsterFunnel.tsx`.
16. `(app)/app/report` + `WeeklyReport.tsx`, `LossReview.tsx` (print styles land here).
17. `(app)/app/alerts` + `AlertsPanel.tsx`, `LivePanel.tsx` (the live-move flash of §9).
18. `(app)/app/ranking` + `LeaderboardPanel.tsx`, `IntelBoard.tsx`.
19. `(app)/app/settings`, `(app)/app/conta`, `(app)/app/referral` + `SettingsPanel.tsx`,
    `AccountPanel.tsx`, `ReferralPanel.tsx` — forms and account states.

**Wave 3 — admin**
20. `admin` + `AdminDashboard.tsx`, `AdminUsers.tsx`, `AdminOps.tsx`, `AdminAcquisition.tsx`,
    `AdminFeatured.tsx`, `PromptPanel.tsx`, `LearningPanel.tsx` — the KPI grid with no holes, real
    tables with empty states, one currency per group, the cyan primary retired.

**Wave 4 — marketing and funnel**
21. `MarketingShell.tsx` — header, footer, `comfortable` density, the 12-column marketing grid.
22. `(marketing)` landing — the §5.3 splits; the hero keeps the ladder (it is the product's real
    output) but rebuilt as a full-bleed ruled table, and the four-equal-plan-cards block is
    replaced by a comparison table.
23. `(marketing)/prova` + `ProofStrip.tsx` — the credibility page: measure capped, KPI row aligned,
    neutral voice for ROI, print styles.
24. `(marketing)/planos` + `PlanPicker.tsx`, `(marketing)/pagamento/[status]` — pricing as a table,
    the period picker, the checkout result states.
25. `(marketing)/[sport]`, `(marketing)/jogo/[gameId]`, `(marketing)/p/[slug]` — the SEO/funnel
    pages, which must look like the app they preview.
26. `(marketing)/ferramentas` + `Calculators.tsx`, `(marketing)/raio-x-tipster`,
    `(marketing)/tipster-audit` — the free tools.
27. `login`, `signup` + `AuthForm.tsx` — the narrowest surfaces, highest conversion cost.
28. `(marketing)/contato` + `ContactForm.tsx`.
29. Legal set — `termos`/`terms`, `privacidade`/`privacy`, `reembolso`/`refunds`, `cookies`,
    `jogo-responsavel`/`responsible-gambling` + `LegalPage.tsx`, `LegalLinks.tsx`, `Disclaimer.tsx`
    — `text-body` at 72ch, a running table of contents, print styles.

**Wave 5 — the edges**
30. `error.tsx`, `global-error.tsx`, `not-found.tsx` + `ErrorScreen.tsx`.
31. `icon.svg`, `apple-icon.tsx`, `og-default.png` and the per-page OG images — redrawn in the new
    mark and the new type.
32. `WhatsNew.tsx` — the clipping strip becomes a dismissible list with a real overflow rule.

---

## 16. Risks and open questions

- **Build-time font fetch.** `next/font/google` downloads at build time. The Docker build on the
  VPS must reach `fonts.gstatic.com` or the build fails. It already does this for Geist, so the
  risk is unchanged — but three families instead of two means three fetches. Mitigation if it ever
  bites: vendor the four `.woff2` files into `public/fonts/` and switch to `next/font/local`.
- ~~**Payload.**~~ **Measured in wave 0: 217.2 KB over six files** (Chromium, production build,
  pt-BR page), inside the 260 KB budget, without dropping Plex Mono 600 — see §3.4. Note that
  `next/font` still *declares* every subset's `@font-face` (24 faces, 512 KB on disk); the `subsets`
  option decides only what is preloaded, and the browser fetches a face when a glyph needs it.
- **The rail costs horizontal space.** 224 px off a 1440 px screen is real. The dock is therefore
  hidden below 1280 px and the rail collapses below it; this needs a look at 1280 and 1366 before
  wave 2 ships.
- **Light theme is new work, not a repaint.** The product has only ever been dark
  (`color-scheme: dark` is hard-coded). Every component in §12 must be checked in both themes; the
  budget for that is real and belongs in wave 0, not at the end.
- **Team crests.** Desaturating third-party marks is a design decision with a licensing shadow; if
  it is ever contested, the fallback is the mono abbreviation, which the dense tables already use.
- **The ladder is the strongest thing on the current landing** and it survives — rebuilding it as a
  table risks losing the one visual that shows the product's argument. Build it first in wave 4 and
  compare side by side before replacing the current version.
- **No visual regression harness exists.** The e2e suite asserts behaviour, not pixels. Waves 1–4
  should add a small Playwright screenshot pass at 1440 and 390 in both themes so a later change
  cannot quietly undo this.

---

## Appendix A — token contract

Names are the contract; §6–§9 hold the values. Everything is a CSS custom property declared in
`globals.css`, exposed to Tailwind 4 through `@theme`. **No component may use a raw hex, a raw px
size, or an arbitrary Tailwind value (`text-[13.5px]`, `bg-[#0d0f14]`).**

```
surface-0 surface-1 surface-2 surface-3
text-primary text-secondary text-tertiary text-disabled text-inverse
border border-strong border-control
action-bg action-fg   focus
pos pos-tint   neg neg-tint   warn warn-tint
chance-1 … chance-5                 (the one sequential ramp, §6.5)
s-0 … s-14                          (spacing, §5.1)
r-0 r-1 r-2 r-3 r-full              (radius, §8.1)
row-h cell-px panel-p stack-gap     (density, §7 — set by [data-density])
dur-1 dur-2 dur-3 ease-out ease-in ease-inout
elev-pop elev-dialog
font-display font-sans font-mono
text-micro text-label text-tiny text-sm text-base text-body text-lead
text-h3 text-h2 text-h1 text-display text-mega
```

Guardrails worth adding in wave 0, so the system cannot rot: an ESLint rule (or a `grep` in CI)
that fails on `text-\[`, `bg-\[#`, `border-\[#`, `rounded-2xl`, `backdrop-blur`, and on the old
`ink-*` / `mist-*` / `edge-*` token names once they are gone.

## Appendix B — how to look at the work

Do not judge this system in a dev server. The audit in §2 was produced like this, and every wave
should be checked the same way:

```bash
# 1. production build (never while a dev server of this repo is running)
AUTH_SECRET=$(openssl rand -hex 32) NEXT_PUBLIC_BASE_URL=http://localhost:3310 pnpm build

# 2. throwaway data, seeded so no screen is empty
rm -rf data/design
DATA_DIR=data/design ADMIN_EMAIL=… ADMIN_PASSWORD=… npx tsx scripts/seed-sev-val.mts

# 3. serve it (test switches like AI_MOCK are refused by the production guard — leave them out)
DATA_DIR=data/design AUTH_SECRET=… APP_URL=http://localhost:3310 \
  NEXT_PUBLIC_BASE_URL=http://localhost:3310 CACHE_DIR=data/design/cache \
  SOFASCORE_DISABLED=1 PROOF_MIN_DECIDED=1 npx next start -p 3310

# 4. shoot 1440×900 and 390×844 at DPR 2, both themes, and *look at the PNGs*
#    /design needs ADMIN_EMAIL + ADMIN_PASSWORD on the server and a login in the script.
```

Minimum set per wave: the landing, `/planos`, `/prova`, `/app`, `/app/bankroll`,
`/app/parlays/custom`, `/admin`, plus 390 px versions of the landing, `/app` and `/app/bankroll`.
A screen nobody has looked at is not finished.

---

## Appendix C — what wave 0 actually shipped, and where it differs from the spec

Written after building it, so the doc and the code agree. Branch `feat/design-system`.

**Files**

| File | What it is |
|---|---|
| `src/app/globals.css` | the whole token layer: both palettes, density, radius, motion, focus, table states, print, the styled range, four custom utilities |
| `src/app/layout.tsx` | Archivo + IBM Plex Sans + IBM Plex Mono, `data-theme` / `data-density`, the pre-paint theme script |
| `public/icons.svg` + `src/components/Icon.tsx` | the 24-glyph sprite |
| `src/components/ui.tsx` | the primitive layer (usage rules at the top of the file) |
| `src/components/ui-client.tsx` | dialog, tabs, range, theme/density switches — re-exported from `ui.tsx` |
| `src/lib/format.ts` | the pt-BR number set, with `src/lib/__tests__/format-numbers.test.ts` |
| `src/app/design/page.tsx` + `src/components/DesignGallery.tsx` | `/design` — operator-only (`requireAdmin`, 404 to everyone else), noindex, disallowed in `robots.ts`, absent from the sitemap |

**Names: contract → implementation.** Appendix A is the contract; this is how it is spelled in code.

| Contract | CSS custom property | Tailwind utility |
|---|---|---|
| `surface-0…3` | `--surface-0…3` | `bg-surface-1` |
| `text-primary / secondary / tertiary / disabled / inverse` | `--fg` / `--fg-muted` / `--fg-dim` / `--fg-faint` / `--fg-inverse` | `text-fg-muted` |
| `border / border-strong / border-control` | `--line` / `--line-strong` / `--line-control` | `border-line-control` |
| `action-bg / action-fg` | `--action` / `--action-fg` (+ `--action-hover`, `--action-active`) | `bg-action text-action-fg` |
| `focus`, `pos`, `neg`, `warn`, tints | same names | `outline-focus`, `text-pos`, `bg-neg-tint` |
| `chance-1…5` | same | `data-chance="3"` on the cell (the ramp is a rule, not a text colour) |
| `s-0…s-14` | same | Tailwind's own 4 px scale (`p-2` = `--s-4`); the vars are for hand-written CSS |
| `r-0…r-3` | same | `rounded-none` / `rounded-control` / `rounded-panel` / `rounded-sheet` |
| `row-h`, `cell-px`, `panel-p`, `stack-gap` | same | `h-(--row-h)`, `px-(--cell-px)`, `p-(--panel-p)`, `gap-(--stack-gap)` |
| `elev-pop / elev-dialog` | same | `shadow-pop` / `shadow-dialog` |
| type scale | — | `text-micro … text-mega` (font-size, line-height, tracking and weight in one token) |

**Deviations, each with its reason**

1. **The ink tokens are `--fg*`, not `--text-*`.** Tailwind 4 owns the `--text-*` namespace for font sizes:
   a colour called `--text-primary` inside `@theme` would become a font size called `primary`.
2. **Spacing is Tailwind's numeric scale**, which is already the 4 px rhythm, rather than a renamed
   `s-*` scale — overriding `--spacing-1` would have silently rewritten `p-1` in 85 untouched files.
   The named vars exist and are what the density tokens are built from.
3. **Dark is still the shipped default** (`data-theme="dark"` on `<html>`). The CSS is both-theme and
   `/design` renders both, but the 85 screens that have never been light are not light-ready; wave 4
   flips the default to the OS setting. The switch already works in both directions today.
4. **The legacy palette survives as aliases**, not as a second palette:
   `ink-950/900/850/800/700/600 → surface-0/1/2 · line · line-strong · line-control`,
   `mist-100/200 → fg`, `mist-300/400 → fg-muted`, `mist-500 → fg-dim`, `mist-600 → fg-faint`,
   `edge-* → pos`, `warn-400 → warn`, `alert-400 → neg`, `signal-* → focus`. Every screen therefore
   inherited the new ramp on the day the tokens landed, and each wave deletes the names it retires.
5. **A control's state change transitions colour for 90 ms.** §9 bans animating colour and also
   defines `--dur-1` as "state change on a control (hover, press, check)" — the transition is what
   that row means; keyframed motion is still opacity and transform only.
6. **`/design` is admin-only.** It is a workbench, not a product surface: an anonymous request gets
   a 404. The screenshot pass therefore signs in first — run the server with `ADMIN_EMAIL` and
   `ADMIN_PASSWORD` set and use `scratchpad/shoot-design.mjs`, which logs in per browser context.
7. **The collapsing table is markup-preserving.** `<Table>` renders `data-collapse="true"` and each
   cell carries `label`; below 768 px the CSS turns rows into definition lists and prints the column
   label from `data-label`. The header stays in the DOM for screen readers.

**Not done in wave 0, on purpose**

- The 159 `toFixed` calls in 61 screens still exist; `src/lib/format.ts` is the place they migrate to,
  wave by wave, as each screen is rebuilt.
- No product screen was restyled: the shell (§15 wave 1), the charts (§11.3) and the marketing grid
  are untouched. The gallery is the only new surface.
- The CI grep guardrail of Appendix A (`text-\[`, `bg-\[#`, `rounded-2xl`, `backdrop-blur`, the old
  token names) is not wired yet — it would fail on the 85 screens it is meant to protect. It lands
  when the last screen stops using the legacy names.

---

## Appendix D — what waves 1–5 actually shipped

Written after applying the system to the product, so the doc and the code agree. Branch
`feat/design-system`, on top of the wave-0 foundations recorded in Appendix C.

### The shell (wave 1)

`src/app/(app)/layout.tsx` is a desk: a 48 px topbar (mark, a hairline, the sport control, the
account corner), a rail, and a work column with **no max-width** — data fills the monitor it was
opened on. `src/components/AppRail.tsx` holds all thirteen destinations in four named groups
(Mesa / Banca / Mercado / Conta); at ≥1024 px they are labelled, between 768 and 1023 the rail
narrows to 56 px of glyphs in the same order, and below 768 it leaves and the five most-used
destinations become a bottom bar. The current item is a 2 px ink bar plus a surface step — never a
hue, because the blue means the keyboard.

`AccountBar` builds its menu from the same `NAV_GROUPS` array, so a phone and a desk read the same
names in the same order, and renaming a destination cannot leave the menu disagreeing with the rail.

### What the screens became

| Surface | Before | Now |
|---|---|---|
| `/app` | three floating cards over 55 % empty viewport | one ruled row per fixture at compact density; the crest is 16 px and drops out below 768 px |
| `/app/bankroll` | three boxed totals, a 500 px amber zigzag | three figures on one rule, the ledger as a table, the curve under the §11.3 grammar |
| `/prova` | five stat boxes, a list of `<li>` | five figures on one rule, a table with a result tone per row |
| `/admin` | eleven boxes with a hole and two currencies in one row | two groups of figures — the business in BRL, the model's bill in USD — each labelled |
| ticket cards | four coloured pills in the header, legs as cards inside cards | `<Odds>` (price + chance, always together), EV as a signed number in ink, legs as ruled rows |
| landing | green kicker, gradient ladder bars, four equal plan cards | display type, the ladder as a table, the plans as a comparison built from the plan model |

### The chart grammar, implemented

`src/components/Chart.tsx` is the only thing in the product that draws a series: a fixed 16:6 frame,
three to five round-number ticks on hairlines, a zero line always drawn one step stronger, a 1.5 px
line clipped `pos` above zero and `neg` below it at the real crossing (two clips over one path, so
the crossing is where it actually is), points only while `n ≤ 30`, and an `sr-only` table twin.
`EquityChart` and the bankroll's own money curve both go through it.

### Sweeps, and why they were sweeps

Three passes touched every screen at once, because a design system that reaches 20 of 86 files is
two design systems:

1. **Palette.** 66 files off `ink-*/mist-*/edge-*/signal-*/alert-*/warn-*` and off arbitrary pixel
   type sizes, onto the token contract.
2. **Controls.** 38 files had their own idea of a button — nine paddings, four weights, three hover
   colours, `opacity-50` for disabled. They now carry the primitive's own geometry, and no screen
   turns off its focus outline.
3. **Labels and tables.** One label style (`u-label`: the condensed display face, uppercase, one
   tracking) instead of four ad-hoc `uppercase tracking-*` combinations; and a base rule in
   `globals.css` so a hand-written `<table>` inherits the header, row height and hairline of the
   `Table` primitive. The primitive's utilities still win, because utilities come after base.

### Deviations from the spec, each with its reason

1. **No dock.** §15 wave 1 called for a 320 px dock holding the slip, the live panel and the budget.
   Those are three different data sources on three different screens; a global dock would have to
   fetch all of them on every page. The rail and the work column shipped; the dock did not.
2. **The date field is still `input[type="date"]`**, not a hand-built calendar popover. The control
   around it is ours — segmented group, our chevrons, our calendar glyph, our label — and the
   platform's own picker button is hidden in CSS, so the field reads as one instrument. Replacing
   the picker itself is a day's work for a control that already behaves correctly on every platform.
3. **The ladder has no bar.** The spec drew the payout as a bar. Built, it read as a filled field
   behind a number, and as a hairline it read as an underline of empty space. The argument is
   already typographic: in tabular mono the payout gains a digit a row while the chance loses one.
4. **Light is still not the shipped default.** `<html data-theme="dark">` stands. Every screen now
   renders correctly in light — the shots in the scratchpad are proof for the landing, `/planos`,
   `/app` and `/app/bankroll` — but flipping the default is a product decision, not a CSS one.
5. **`formatMoneyBRL` survives** alongside `formatMoney`. The plan prices are asserted character by
   character in `tests/e2e/payments.spec.ts`; migrating them is a copy change, not a design change.

### Not done

- **No visual-regression harness.** Screenshots are still taken by hand with the scratchpad scripts.
- **The CI grep guardrail** is still unwired: `text-[`, `bg-[#`, `rounded-2xl`, `backdrop-blur` and
  the retired token names would pass now, but the legacy *aliases* in `globals.css` still resolve, so
  nothing yet forces a new screen to use the new names.
- **Print styles** beyond the palette switch: `/app/report` and `/prova` produce documents and
  deserve a real print sheet.
- **`/app/slip`, `/app/player/[id]`, `/app/tipster` and `/ferramentas`** inherited the sweeps and the
  page head, but their internals were not composed by hand; they are the next screens to open.

### Round two, after looking at the screens

The first pass was written from the spec; this list is what only showed up in a PNG.

- **The chance ramp moved to a numeric cell's trailing edge.** Right-aligned numbers end at the
  right edge, and a 2px rule on the leading edge was reading as part of the column before it.
- **The ladder lost its bar.** Drawn as a filled box it read as a text field; drawn as a hairline it
  read as an underline of empty space. The argument is typographic: in tabular mono the payout gains
  a digit a row while the chance loses one.
- **Blue went back to focus duty.** Fourteen screens used the focus blue for "good" and amber for
  "lost" — two contradictory result palettes, and a focus ring that looked like data.
- **The identity lost its green.** Favicon, home-screen icon and both share cards were a green tile
  with a green wordmark; a settled result is now the only hue on a share card.
- **One title per screen.** Four screens said their own name three times (page head, an h1 in the
  panel stack, the panel's own header).
- **Forms got a measure.** Settings, the slip and both parlay builders were stretching 40-character
  fields across a 1600px column.
- **/ferramentas was the banned pattern verbatim** — three equal cards of unequal height with a void
  under the third. One frame, one top rule, result blocks pinned to the same baseline.
- **Every percentage is pt-BR**, including the ones inside the equity curve's own KPI row, which
  were still printing `0.0%` next to a page of `0,0 %`.
- **The native date button is hidden**: below 640px the platform painted a second calendar inside
  our own control.

---

## Appendix E — round two: what the review found in a screenshot

Wave 6. An adversarial review opened 32 routes at two widths in both themes, measured contrast with
its own sRGB script and read 31 PNGs. Its verdict was "senior-grade foundations, junior-grade edges,
and the edges are on the pages that convert". Everything below is one of its findings, closed.

### The funnel page broke four of this document's own rules on one card

`/jogo/[gameId]` is where search traffic lands. Its teaser carried an emoji as an icon (the only
emoji in `src/`, beside a 43-glyph sprite), a `--pos` border — the colour reserved for a settled win
— around a ticket whose state was *pending*, a multiplier with no chance beside it, and en-US
decimals on a pt-BR document. The teaser now renders through `<Odds>`, which cannot draw a price
without its chance; the card is bordered by a rule; the lock is the sprite's glyph; and the page's
percentages, including the ones inside `gameFaq`, go through `lib/format`.

### Two decimal conventions were shipping side by side

`lib/odds.formatDecimal` was locale-blind, so `/prova` printed `21.00x` in a column under a KPI row
reading `50,0 %`, and `/app/track` put both conventions in one row. `formatDecimal(decimal, lang)`
now delegates to the shared formatter; plain-text outputs that are not a page (a webhook line, share
text) keep the en form by omitting the argument. Thirty-one component-level `toFixed` calls — the
thing §11.2 forbids in one sentence — are gone from the views that compare numbers, and `formatUsd`
joins `formatMoney` so `/admin` stops printing `R$ 0`, `US$ 0.00` and `$0.00 de $20.00` at once.

### Two tokens existed for contrast and the screens bypassed both

`--line-control` is documented as "an affordance, ≥3:1", and 38 hand-rolled controls drew themselves
with `--line-strong` instead: 1.80:1 in dark, 1.43:1 in light, against the 3:1 WCAG asks of a UI
edge. `--fg-faint` is the *disabled* tier (3.69 / 3.17) and 25 places were reading content out of
it — the rail's four group labels on every app screen, the account menu's headings, the landing's
step numbers, leg numbers, placeholders, the page head's kicker. Controls moved to `--line-control`;
content moved to `--fg-dim` (5.65 / 4.86, AA at 10px). `--fg-faint` now appears only behind
`disabled:` and `has-[:disabled]:`.

### The label style was one style in three typefaces

`--text-label` and `--text-micro` carried `letter-spacing` and `font-weight`, so any 11px sentence
in the body face rendered as a tracked-out label: on `/app/game`, 11px/500/0.66px appeared 25× in
Archivo and 46× in Plex Sans. They are sizes again. The label style — uppercase, tracked, 500,
Archivo — is `u-label` and only `u-label`.

### The screen where a user decides had no h1

`/app/game` was carried entirely by 10–13px labels; its largest type was a score. It opens with a
page head now (competition, fixture, kickoff · venue · broadcast), and `PageHead`'s own h1 moved one
step up the scale (20 → 25px) so a screen's name and a panel's title are two steps apart. The player
deep dive had a green kicker and no head at all in its not-found and sign-in states. `/app/track`
rendered its head twice. `/app/parlays/custom` had no heading above 11px.

### Empty was a sentence floating in a 1,216px column

`Empty` now draws the region's own rules at the row height the rows will have, so a reader sees the
shape of what is missing, and `/app/track` stopped printing one identical sentence in three
consecutive panels — each says what *that* panel is waiting for.

### The rest, in one list

- **Twelve native selects** shipped without `appearance-none`; six sat beside a styled one in the
  same view. All twelve go through the `Select` primitive, which gained a `wrapperClassName`.
- **59 copies of the button class** became 59 calls to `buttonClass()` — including the ones that
  cannot be a `<Button>` because they are a `next/link`.
- **`/planos` still had the four equal cards the landing retired**, with the Free column ending in
  ~180px of nothing. It is the landing's comparison table now, from the same `planRows()`.
- **The coin packs' three prices sat on two baselines** because the first pack has no bonus line. A
  ruled table aligns them by construction.
- **The equity curve painted break-even in win-green.** The line is ink unless the series ends above
  zero; a series under five points is drawn narrow; both ends of the x axis stop printing one date.
- **The landing's FAQ painted an empty tenth cell.** Rules belong to the items; an odd count ends.
- **Crests were dimmed, not desaturated** (`opacity` keeps hue); they are `saturate-50` now.
- **Focus on a full-bleed row showed as two disconnected bars**, because the ring's left segment
  falls outside the viewport. Those rows carry `u-ring-inset`.
- **The print sheet had no identity and stranded the 18+ line on a second page.** It has a header
  (wordmark, subject, generated-at) and the shell's `min-height` is dropped for print.
- **`<Odds>` rendered "3,19 7,4 %"** — one number with a decimal error, at a glance. It has a
  separator.
- **The game page's evidence column ended at 1,846px of a 3,849px page.** It sticks under the topbar.
- **The report's amber band was the loudest thing on the screen** for a standing condition. It is a
  rule.

### The guard

`scripts/design-guard.mjs` (`pnpm design:guard`) greps `src/` for the shapes ESLint cannot express:
`--fg-faint` as content, `--line-strong` on a control, an emoji in a `.tsx`, a decorative gradient or
`backdrop-blur` or `rounded-2xl`, a raw hex in a className, and `toFixed` in a view. It exits
non-zero, so the next screen cannot quietly reintroduce any of them. A deliberate exception is
marked inline with `design-guard-allow`.

### Still open after wave 6

- The 320px dock from §15 is still not built, so a data-light `/app` is still a wide page rather
  than a desk.
- `PlayerChart` still draws its own axes instead of going through §11.3's chart grammar.
- There is no visual-regression harness; screenshots are still taken by hand.
- The legacy token aliases in `globals.css` still resolve, so the guard catches new names but the
  old ones are not yet deleted.

---

## Appendix F — the phone

Written after building it, on `feat/mobile-app-feel`, and rewritten after the adversarial review of
that branch, so the doc and the code agree. The brief was one sentence from the owner: on a phone
the product has to read as an app and be obvious. It is the same system at 390 px — the same ramp,
rules, numerals and prohibitions — with these decisions.

**Chrome.** The bottom bar of §12.7 is fixed, 56 px plus the hairline above it plus the device's
own inset (`--safe-b`, read once in `globals.css`), and `--tabbar-h` is that whole height, so
nothing is ever a pixel under it. It holds Jogos · Múltiplas · Banca · Conta and, while a game of
the current sport is being played, that game as a fifth tab named `DUN × CED` with the live dot.
The shell decides that fifth tab on the server, from the remembered sport and the cached
scoreboard, so the bar is right on first paint and never reflows; the phone then re-reads the
slate every 90 s (a game can start while the app is open), under its own rate-limit rule. The
current tab carries the rail's cue — a 2 px ink rule and full-contrast text — because the product
has one current-item colour and it is not a hue. The topbar is padded by the status bar an
installed app keeps (`--safe-t`), and `--topbar-h` includes it, so the rail and the game page's
compact head start under the bar on a notched phone too. The tour card and the session reminder
anchor to `--float-b`, above the bar; the tour card is placed from measurements taken in an
effect — its own height, the bar's, the viewport's — below the anchor when it fits, above it when
it does not, in the corner when neither does.

**The slate.** Below 768 px the table leaves and each fixture is a card (`GameCard`): kickoff or the
live clock, both teams with crests and scores, the three market numbers in tabular mono — the
handicap takes what is left, total and winner take exactly their numbers' width, and a number is
never cut short — and a chevron that becomes a spinner while the tap's navigation is pending. The
whole card is one real link. Both the cards and the table are in the server's HTML and the
breakpoint chooses, because that surface is rendered on the server; the band chips on a game page
are built by the client along with the tickets they filter, so they are gated by the same
breakpoint read in JavaScript (`useIsPhone`) and never exist in a desk's DOM, where their labels
would answer a search for a price. Two mechanisms, one rule: a surface switches by CSS when the
server drew it and by `matchMedia` when the client did.

**The game page.** A compact head (`GameStickyHead`, 44 px) slides under the topbar once the full
team block has scrolled away and reads the score the live panel polls, from the same request. The
live panel draws its own frame while its first poll is in flight, so the tickets below it do not
jump when it arrives. The odds bands are chips a thumb swipes (`u-swipe`: snapping that respects
the strip's own padding, so the first chip rests on the tickets' edge; a 44 px hit area kept inside
the scroll box). One primary action lives in a bar above the tab bar (`GameActionBar`): the action
the page's regions offered with the highest priority — the live read, the day's pick, generation,
sign-up or the plans, else `Ver bilhetes` — and only that one, shown while its own inline control is
off screen and gone the moment that control is in view. It never falls through to a lesser action,
so its label cannot change under a scrolling thumb. It is the page's last element and sticks above
the tabs for as long as its own place is below the fold; at the end of the page it rests in flow,
above the footer, so the responsible-gambling line is never covered. The market table collapses to
a definition list per book (§11.1) and its empty state draws no empty rows.

**Touch.** Below 768 px `--row-h` is 44 px, so every control drawn at the row height is a target.
A control drawn smaller gets one of two things: a real box (`min-height`, padding) where a
neighbour is closer than 44 px — the topbar's menu and balance, the date control's arrows, the
follow buttons, the roster and panel links, the footer's legal links, the auth page's two links,
the player page's steppers — or the transparent 44 px hit area of `u-hit` where nothing else is
near. `u-hit` exists only below 768 px: a desk has a pointer. Selectable chips share one class
(`chipClass`): pressed is the action fill on both sizes; on a phone they grow to 36 px plus the hit
area and take the body size. Stakes, lines and ceilings open the decimal keypad; e-mail opens the
e-mail one; a stake field is six characters wide, so a ticket's footer fits a 320 px phone.

**Type.** The 12 px floor of §4: `text-micro` and `text-label` rise to 12 px below 768 px and the
step is carried by weight and by case. The two charts draw their viewBox at the width they are
rendered, so a tick label is a true 12 px on a phone and a bar's label is thinned when the bars are
too narrow to carry one each. The hand-written table header and the collapsed row label read the
label token, so the floor reaches them too.

**Loading.** The slate streams its own frame — the head's shape, the date control's box, cards on a
phone and the table's columns on a desk — through a `Suspense` boundary placed *after* the page's
redirect, not through a `loading.tsx`: a loading file flushes the shell before the page runs, which
turns `redirect()` and `notFound()` into client-side hops with a 200. The game page keeps its real
404 for the same reason; the tickets panel loads as two ticket cards in the final shape instead of
a sentence.

**Install.** `manifest.ts` (standalone, no orientation lock — a tablet turns — the dark page surface
as both colours because dark is the shipped default), the mark as 192/512/maskable PNGs rasterised
from the favicon's geometry, `viewport-fit=cover` and the Apple web-app meta. A bare `/app`, which
is where the installed app opens, redirects in the account's own language. No service worker, on
purpose: nothing behind a login is ever cached, and current browsers install without one.

**Width is never content's to set.** Two mechanisms let one wide thing set the width of a whole
page on a phone, and both are closed. A column with auto side margins that is a flex item of the
body (the admin's root) shrinks to fit its content, so it carries `w-full`; and a grid that declares
its columns only from a breakpoint up has one implicit `auto` column below it, whose floor is the
widest thing inside — on a phone that column is `minmax(0, 1fr)` (`globals.css`). A flex item that
must be able to shrink says so (`min-w-0`): a ticket's footer once refused to be narrower than a
twenty-character field plus a button and set the width of the page at 360 px. The sideways scroll a
table is allowed (§11.1) stays inside its own wrapper, and the phone e2e measures overflow against
the device width rather than `innerWidth`, which grows with the page and had hidden every case —
at 393 px and at 360 px, in two Playwright projects.

**Desk changes that came with this, all of them §12 fixes, listed so nobody finds them by
surprise:** the auth pages' title is `text-h3` (25 px) instead of an off-scale 27 px and their fields
are the row height; the settings ceilings and bankroll amount go through `Field`/`Input` (right-
aligned, mono); the tipster's raw file control is a button; a ticket's "Adicionar à banca" and the
alerts' Telegram buttons carry the button primitive's geometry; a followed league is a pressed chip
(the action fill) instead of a raised surface; and every placeholder is prose in the body face, even
inside a numeric field. Nothing else on a desk moved.

**Not done.** The header still shows the sport picker, not a date picker; a per-viewer density
choice is still ignored below 768 px. Text links that sit side by side in a footer row are 44 px
tall but 16 px apart horizontally, which is what a row of links is; the public track record's
filter controls are not part of the app and keep their compact height.
