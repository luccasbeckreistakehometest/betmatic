import { readLedger } from "@/lib/ledger/store";
import { ticketSlug } from "@/lib/ledger/proof";
import { scrubText } from "@/lib/server/whitelabel";

export const dynamic = "force-dynamic";

/** The whole public record as a spreadsheet. Whitelabelled like the page; anyone can audit it. */
export async function GET(request: Request) {
  const lang = new URL(request.url).searchParams.get("lang") === "en" ? "en" : "pt";
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["created_at", "settled_at", "sport", "matchup", "title", "kind", "band", "odds", "modelled_probability", "outcome", "legs", "link"].join(",")];
  for (const e of readLedger()) {
    rows.push([e.createdAt, e.settledAt ?? "", e.sportKey, scrubText(e.matchup, lang), scrubText(e.title, lang), e.kind, e.bandKey, e.combinedDecimal.toFixed(2), e.modelledProbability.toFixed(3), e.outcome,
      e.legs.map((l) => `${scrubText(l.selection, lang)} @${l.oddsDecimal.toFixed(2)} [${l.outcome}]`).join(" | "), `${base}/p/${ticketSlug(e.id)}`].map(q).join(","));
  }
  return new Response("﻿" + rows.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="betmatic-prova-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
