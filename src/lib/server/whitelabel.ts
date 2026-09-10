import type { BetLeg, BetSlate, BetSuggestion } from "@/lib/types";
import type { Role } from "@/lib/plans";

/**
 * Named third-party sources the product must not attribute to non-admins. The value the user is
 * paying for is the synthesis; naming the inputs both devalues it and advertises the competition.
 */
type Gender = "m" | "f" | "mp" | "fp";

interface SourceRule {
  /** Body of the pattern, without the optional leading article. */
  body: string;
  flags: string;
  pt: { text: string; gender: Gender };
  en: string;
}

const SOURCE_RULES: SourceRule[] = [
  { body: "props\\s*cash", flags: "gi", pt: { text: "modelo de props", gender: "m" }, en: "props model" },
  { body: "mama\\s*knows\\s*bets", flags: "gi", pt: { text: "consenso de especialistas", gender: "m" }, en: "expert consensus" },
  { body: "dimers", flags: "gi", pt: { text: "modelo estatístico", gender: "m" }, en: "statistical model" },
  { body: "oddsshark", flags: "gi", pt: { text: "modelo estatístico", gender: "m" }, en: "statistical model" },
  { body: "teamrankings", flags: "gi", pt: { text: "modelo de ratings", gender: "m" }, en: "ratings model" },
  { body: "\\bcovers\\b", flags: "gi", pt: { text: "consenso público", gender: "m" }, en: "public consensus" },
  { body: "\\bESPN\\b", flags: "g", pt: { text: "dados oficiais", gender: "mp" }, en: "official data" },
  // Reporter handles are the most identifying signal of all.
  { body: "@[A-Za-z0-9_]{3,}", flags: "g", pt: { text: "apuração de imprensa", gender: "f" }, en: "press reporting" },
  { body: "\\b(?:insider\\s+X|no\\s+X|on\\s+X)\\b", flags: "gi", pt: { text: "apuração de imprensa", gender: "f" }, en: "press reporting" },
];

/**
 * Portuguese articles agree with the noun they precede, and the replacements do not share a gender
 * with the brand names they stand in for — leaving the original article produces "o apuração".
 * The article is captured and re-emitted in the right form.
 */
const ARTICLES: Record<string, Record<Gender, string>> = {
  o: { m: "o", f: "a", mp: "os", fp: "as" },
  a: { m: "o", f: "a", mp: "os", fp: "as" },
  os: { m: "o", f: "a", mp: "os", fp: "as" },
  as: { m: "o", f: "a", mp: "os", fp: "as" },
  um: { m: "um", f: "uma", mp: "uns", fp: "umas" },
  uma: { m: "um", f: "uma", mp: "uns", fp: "umas" },
  do: { m: "do", f: "da", mp: "dos", fp: "das" },
  da: { m: "do", f: "da", mp: "dos", fp: "das" },
  no: { m: "no", f: "na", mp: "nos", fp: "nas" },
  na: { m: "no", f: "na", mp: "nos", fp: "nas" },
  pelo: { m: "pelo", f: "pela", mp: "pelos", fp: "pelas" },
  pela: { m: "pelo", f: "pela", mp: "pelos", fp: "pelas" },
  ao: { m: "ao", f: "à", mp: "aos", fp: "às" },
  à: { m: "ao", f: "à", mp: "aos", fp: "às" },
};

const ARTICLE_GROUP = Object.keys(ARTICLES).join("|");

function scrub(text: string | undefined, lang: "pt" | "en"): string {
  if (!text) return "";
  return SOURCE_RULES.reduce((acc, rule) => {
    if (lang === "en") {
      return acc.replace(new RegExp(rule.body, rule.flags), rule.en);
    }
    const pattern = new RegExp(`(\\b(?:${ARTICLE_GROUP})\\s+)?(?:${rule.body})`, rule.flags);
    return acc.replace(pattern, (_match, article?: string) => {
      if (!article) return rule.pt.text;
      const raw = article.trim();
      const corrected = ARTICLES[raw.toLowerCase()]?.[rule.pt.gender] ?? raw;
      // Keep sentence-initial capitalisation that the original article carried.
      const cased = /^[A-ZÀ-Ú]/.test(raw) ? corrected.charAt(0).toUpperCase() + corrected.slice(1) : corrected;
      return `${cased} ${rule.pt.text}`;
    });
  }, text);
}

function scrubLeg(leg: BetLeg, lang: "pt" | "en"): BetLeg {
  return {
    ...leg,
    book: leg.book,
    explanation: scrub(leg.explanation, lang),
    evidence: scrub(leg.evidence, lang),
    settlement: leg.settlement
      ? { ...leg.settlement, sourceBasis: scrub(leg.settlement.sourceBasis, lang) }
      : undefined,
  };
}

export function scrubSuggestion(bet: BetSuggestion, lang: "pt" | "en"): BetSuggestion {
  return {
    ...bet,
    title: scrub(bet.title, lang),
    background: scrub(bet.background, lang),
    riskNote: scrub(bet.riskNote, lang),
    evidenceNotes: bet.evidenceNotes.map((n) => scrub(n, lang)),
    legs: bet.legs.map((l) => scrubLeg(l, lang)),
  };
}

/**
 * Applied at serialisation, never in the UI — hiding a name with CSS still ships it to the browser
 * and it shows up in devtools or the network tab.
 */
export function scrubSlate(slate: BetSlate, role: Role, lang: "pt" | "en"): BetSlate {
  if (role === "admin") return slate;
  return {
    suggestions: slate.suggestions.map((s) => scrubSuggestion(s, lang)),
    dataNote: scrub(slate.dataNote, lang),
  };
}
