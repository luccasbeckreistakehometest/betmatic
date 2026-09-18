import { ImageResponse } from "next/og";
import { readLedger } from "@/lib/ledger/store";
import { findBySlug, isPublicTicket } from "@/lib/ledger/proof";
import { scrubText } from "@/lib/server/whitelabel";
import { formatDecimal } from "@/lib/odds";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The card WhatsApp and X unfurl when a ticket link is shared: outcome, price, legs, brand. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = findBySlug(readLedger(), slug);
  // Before kickoff the card carries no pick: title, legs and price are the paid product.
  const e = found && isPublicTicket(found) ? found : null;
  const outcome = e?.outcome ?? "pending";
  // The system ramp: a settled result is the only thing on this card that carries a hue.
  const color = outcome === "won" ? "#3ed598" : outcome === "lost" ? "#ff6b70" : "#aeb5c2";
  const label = { won: "GANHOU", lost: "PERDEU", push: "PUSH", void: "ANULADO", pending: "PENDENTE" }[outcome];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "#0a0c11", color: "#edf0f5", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}><div style={{ width: 44, height: 44, borderRadius: 6, background: "#edf0f5" }} /><div style={{ fontSize: 34, fontWeight: 700 }}>Betmatic</div></div>
          <div style={{ fontSize: 30, fontWeight: 800, color, border: `3px solid ${color}`, borderRadius: 2, padding: "8px 28px" }}>{label}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1 }}>{e ? scrubText(e.title, "pt").slice(0, 60) : found ? "Bilhete liberado quando a bola rolar" : "Bilhete"}</div>
          <div style={{ fontSize: 30, color: "#868ea0" }}>{found ? scrubText(found.matchup, "pt") : ""}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {(e?.legs ?? []).slice(0, 4).map((l, i) => (<div key={i} style={{ display: "flex", gap: 10, fontSize: 26, color: "#aeb5c2" }}><span>•</span><span>{scrubText(l.selection, "pt").slice(0, 70)}</span></div>))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 28, color: "#868ea0" }}>
          <div style={{ display: "flex", gap: 8 }}><span>odd</span><span style={{ color: "#edf0f5", fontWeight: 700 }}>{e ? formatDecimal(e.combinedDecimal) : "—"}</span></div>
          <div>histórico público · liquidado automaticamente</div>
        </div>
      </div>
    ),
    size,
  );
}
