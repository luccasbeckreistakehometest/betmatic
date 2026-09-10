"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { LANGS, normaliseLang } from "@/lib/i18n";

/** Standalone from the app's picker: the landing has no sport or date to preserve. */
export function LandingLang() {
  const params = useSearchParams();
  const router = useRouter();
  const lang = normaliseLang(params.get("lang"));

  return (
    <div className="flex overflow-hidden rounded-lg border border-ink-700">
      {LANGS.map((l) => (
        <button
          key={l.key}
          onClick={() => router.push(`/?lang=${l.key}`)}
          className={`px-2 py-1 text-[11px] font-medium transition ${
            lang === l.key ? "bg-ink-700 text-mist-100" : "bg-ink-900 text-mist-500 hover:text-mist-200"
          }`}
        >
          {l.flag}
        </button>
      ))}
    </div>
  );
}
