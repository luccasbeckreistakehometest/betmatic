import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const dynamic = "force-static";

const BARS = [8, 14, 19, 11];

/** The site-wide share card (WhatsApp, Telegram, X) for pages without their own image. */
export async function GET() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#0a0c11", color: "#edf0f5", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div style={{ width: 84, height: 84, borderRadius: 8, background: "#edf0f5", display: "flex", flexDirection: "column", justifyContent: "center", gap: 7, paddingLeft: 18 }}>
            {BARS.map((w, i) => <div key={i} style={{ width: w * 2.6, height: 10, borderRadius: 2, background: "#0a0c11" }} />)}
          </div>
          <div style={{ display: "flex", fontSize: 58, fontWeight: 700, letterSpacing: -2 }}>
            <span>bet</span><span style={{ color: "#868ea0" }}>matic</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>Toda odd esconde uma chance.</div>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, color: "#868ea0" }}>A gente mostra qual.</div>
          <div style={{ display: "flex", fontSize: 30, color: "#868ea0", marginTop: 8 }}>Basquete e futebol · histórico público · todo palpite conferido</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#868ea0" }}>
          <span>Ferramenta de pesquisa · 18+</span>
          <span>Aposta não é investimento</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "cache-control": "public, max-age=86400" } },
  );
}
