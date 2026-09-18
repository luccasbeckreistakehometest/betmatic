# Betmatic — Design System: *Mesa de Operações*

Status: specification. Written 2026-09-18 on `feat/design-system`, before any product code changed.
Audience: whoever rebuilds the surfaces listed in §14. Every number here is a decision, not a default.

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
core and never fall back mid-word).

### 3.1 Display / voice — **Archivo** (variable: `wght` 400–700, `wdth` 62–125)

Omnibus-Type's industrial grotesque, drawn for high-performance printing and screen signage. It is
chosen for three reasons: (a) the **width axis is the identity move** — no other free family lets a
headline be set at `wdth 112` and a dense table header at `wdth 82` in the *same* voice, which is
exactly the range this product needs; (b) its numerals are squarish and flat-sided, so a 48 px
"50,0 %" on `/prova` reads like an instrument readout rather than a marketing number; (c) it is a
Latin-American foundry face with complete Portuguese coverage, which is a better cultural fit for a
pt-BR-first product than another American UI sans.

```
Archivo   400 / 500 / 600 / 700     wdth 82 (condensed labels) · 100 (default) · 112 (display)
fallback: "Archivo Fallback", "Helvetica Neue", Arial, sans-serif
```

Used for: `h1`–`h3`, page titles, section titles, the wordmark, KPI values above 24 px, table
column headers (at `wdth 82`, 500). Nothing below 11 px.

### 3.2 Text / UI — **IBM Plex Sans** (400 / 500 / 600)

Drawn by Bold Monday for interfaces where a misread character is a defect, which is the condition
here: `1` vs `l`, `0` vs `O`, and a disambiguated `rn`/`m` matter when the string is `MIN −6.5` or
`IND −14.5`. Its x-height is tall enough to stay legible at the 12 px this product needs in table
cells, and its accents are drawn tight enough that `ç`, `ã`, `õ`, `é` do not collide with the line
above at 1.3 leading. It also ships true `tnum`.

```
IBM Plex Sans   400 / 500 / 600
fallback: "IBM Plex Sans Fallback", -apple-system, "Segoe UI", Roboto, sans-serif
```

Used for: all body copy, labels, buttons, form fields, navigation, microcopy, legal text.

### 3.3 Numerals / code — **IBM Plex Mono** (400 / 500 / 600)

Same skeleton, same foundry, same vertical metrics as Plex Sans — which is the whole argument. When
a row reads `Sevilha ou empate` (Plex Sans) `1,26` (Plex Mono) the two halves sit on the same
baseline with the same colour of grey and the same apparent weight. A mono from another family
(the current `Geist Mono` next to `Geist Sans`) always looks pasted in.

```
IBM Plex Mono   400 / 500 / 600
fallback: "IBM Plex Mono Fallback", ui-monospace, SFMono-Regular, "Roboto Mono", monospace
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

**Measure.** Prose is capped at `65ch` (marketing) and `72ch` (legal pages, which are read in long
runs). Panel prose inside the app is capped at `58ch`. No text block is ever full-bleed.

**Optical details.**
- Hanging punctuation on pull-quotes and the honesty statements: `hanging-punctuation: first;`
  with a `-0.4em` text-indent fallback on the one component that uses it.
- Uppercase labels always carry positive tracking (see table); lowercase never does.
- Baselines align between a label and its value: a KPI label sits on the 4 px grid and the value's
  cap-height starts exactly 8 px below the label's baseline (`--kpi-gap: 8px`), so a row of KPIs
  scans as a line, not as five separate boxes.
