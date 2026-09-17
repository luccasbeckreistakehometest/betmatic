import type { Metadata } from "next";
import type { Lang } from "@/lib/i18n";

export const SITE_NAME = "Betmatic";

export const DEFAULT_META: Record<Lang, { title: string; description: string }> = {
  pt: {
    title: "Betmatic — a chance real ao lado de cada odd",
    description: "Bilhetes de basquete e futebol com a probabilidade real ao lado, histórico medido jogo a jogo e todo palpite conferido depois do jogo. Ferramenta de pesquisa, 18+.",
  },
  en: {
    title: "Betmatic — the real probability next to every price",
    description: "Basketball and soccer tickets with the real probability beside them, player history measured game by game, and every pick graded after the game. Research tool, 18+.",
  },
};

/**
 * Title, description, canonical and hreflang for a public page that exists in both languages.
 * `paths` are the pt and en URLs (path plus any query, e.g. "/prova?lang=en").
 */
export function pageMetadata(input: { lang: Lang; title: string; description: string; paths: Record<Lang, string>; index?: boolean; image?: string }): Metadata {
  const { lang, title, description, paths } = input;
  return {
    title,
    description,
    alternates: {
      canonical: paths[lang],
      languages: { "pt-BR": paths.pt, en: paths.en, "x-default": paths.pt },
    },
    openGraph: {
      title,
      description,
      url: paths[lang],
      siteName: SITE_NAME,
      locale: lang === "pt" ? "pt_BR" : "en_US",
      type: "website",
      ...(input.image ? { images: [input.image] } : {}),
    },
    twitter: { card: "summary_large_image", title, description },
    ...(input.index === false ? { robots: { index: false, follow: false } } : {}),
  };
}

/** Same page, English variant carried by ?lang=en. */
export const langPaths = (path: string): Record<Lang, string> => ({ pt: path, en: `${path}${path.includes("?") ? "&" : "?"}lang=en` });

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export interface SearchProps { searchParams: SearchParams }

export async function langFrom(searchParams: SearchParams): Promise<Lang> {
  const q = await searchParams;
  return q.lang === "en" ? "en" : "pt";
}
