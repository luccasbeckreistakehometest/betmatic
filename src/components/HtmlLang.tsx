"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/** Keeps <html lang> in step when the language toggles without a full page load. */
export function HtmlLang({ fallback }: { fallback: "pt" | "en" }) {
  const params = useSearchParams();
  const fromQuery = params.get("lang");
  useEffect(() => {
    const lang = fromQuery === "en" || fromQuery === "pt" ? fromQuery : fallback;
    document.documentElement.lang = lang === "en" ? "en" : "pt-BR";
  }, [fromQuery, fallback]);
  return null;
}
