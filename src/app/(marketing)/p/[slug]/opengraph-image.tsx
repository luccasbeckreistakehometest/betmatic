import { ImageResponse } from "next/og";
import { readLedger } from "@/lib/ledger/store";
import { findBySlug } from "@/lib/ledger/proof";
import { scrubText } from "@/lib/server/whitelabel";
import { formatDecimal } from "@/lib/odds";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The card WhatsApp and X unfurl when a ticket link is shared: outcome, price, legs, brand. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const e = findBySlug(readLedger(), slug);
  const outcome = e?.outcome ?? "pending";
  const color = outcome === "won" ? "#3ddc97" : outcome === "lost" ? "#ff6b6b" : "#b8c2d4";
  const label = { won: "GANHOU", lost: "PERDEU", push: "PUSH", void: "ANULADO", pending: "PENDENTE" }[outcome];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "#0d0f14", color: "#f2f5fa", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}><div style={{ width: 44, height: 44, borderRadius: 10, background: "#3ddc97" }} /><div style={{ fontSize: 34, fontWeight: 700 }}>Betmatic</div></div>
          <div style={{ fontSize: 30, fontWeight: 800, color, border: `3px solid ${color}`, borderRadius: 999, padding: "8px 28px" }}>{label}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1 }}>{e ? scrubText(e.title, "pt").slice(0, 60) : "Bilhete"}</div>
          <div style={{ fontSize: 30, color: "#8a94a8" }}>{e ? scrubText(e.matchup, "pt") : ""}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {(e?.legs ?? []).slice(0, 4).map((l, i) => (<div key={i} style={{ display: "flex", gap: 10, fontSize: 26, color: "#b8c2d4" }}><span>•</span><span>{scrubText(l.selection, "pt").slice(0, 70)}</span></div>))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 28, color: "#8a94a8" }}>
          <div style={{ display: "flex", gap: 8 }}><span>odd</span><span style={{ color: "#f2f5fa", fontWeight: 700 }}>{e ? formatDecimal(e.combinedDecimal) : "—"}</span></div>
          <div>histórico público · liquidado automaticamente</div>
        </div>
      </div>
    ),
    size,
  );
}
