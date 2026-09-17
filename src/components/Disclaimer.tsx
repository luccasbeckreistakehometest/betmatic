"use client";

import { useNavState } from "@/components/Controls";
import { makeT } from "@/lib/i18n";

export function Disclaimer() {
  const { lang } = useNavState();
  const t = makeT(lang);
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-1.5 text-xs text-mist-500">
      <p>{t("disclaimer")}</p>
      <p>{t("responsible")}</p>
      <p className="text-mist-400" data-testid="not-investment">{t("notInvestment")}</p>
    </div>
  );
}
