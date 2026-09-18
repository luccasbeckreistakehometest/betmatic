"use client";

import { useNavState } from "@/components/Controls";
import { LegalLinks } from "@/components/LegalLinks";
import { makeT } from "@/lib/i18n";

/**
 * The legal foot of the app. Caution, not error: the responsible-gambling notice is a standing
 * condition of the product, and painting it red would make it read as a failure (§13).
 */
export function Disclaimer() {
  const { lang } = useNavState();
  const t = makeT(lang);
  return (
    <div className="flex flex-col gap-2 text-tiny text-fg-dim">
      <LegalLinks lang={lang} className="mb-1" />
      <p className="max-w-measure-legal">{t("disclaimer")}</p>
      <p className="max-w-measure-legal border-l-2 border-warn pl-2.5 text-warn">{t("responsible")}</p>
      <p className="max-w-measure-legal text-fg-muted" data-testid="not-investment">{t("notInvestment")}</p>
    </div>
  );
}
