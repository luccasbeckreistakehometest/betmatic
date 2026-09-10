"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useNavState } from "@/components/Controls";
import { makeT } from "@/lib/i18n";

interface Me {
  user: { name: string; role: "user" | "admin"; coins: number; plan: { id: string; name: string } } | null;
}

export function AccountBar() {
  const { lang } = useNavState();
  const t = makeT(lang);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      const response = await fetch("/api/auth/me", { cache: "no-store" }).catch(() => null);
      if (response?.ok) setMe(await response.json());
      else setMe({ user: null });
    })();
  }, []);

  if (!me) return <div className="h-6 w-24 animate-pulse rounded bg-ink-800" />;

  if (!me.user) {
    return (
      <Link
        href="/login"
        className="rounded-lg border border-ink-700 px-2.5 py-1 text-[12px] text-mist-300 transition hover:border-ink-600 hover:text-white"
      >
        {lang === "pt" ? "Entrar" : "Log in"}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 text-[11px]">
      <span className="nums flex items-center gap-1.5 text-mist-300" title={t("coins")}>
        <span className="size-1.5 rounded-full bg-edge-400" />
        {me.user.coins}
      </span>
      <span className="rounded border border-ink-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-mist-400">
        {me.user.plan.name}
      </span>
      {me.user.role === "admin" && (
        <Link href="/admin" className="text-warn-400 transition hover:text-warn-400/80">
          admin
        </Link>
      )}
    </div>
  );
}
