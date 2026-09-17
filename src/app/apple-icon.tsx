import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const BARS = [8, 14, 19, 11];

/** Home-screen icon: the Betmatic mark on its own green tile. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#4ade80", display: "flex", flexDirection: "column", justifyContent: "center", gap: 13, paddingLeft: 40 }}>
        {BARS.map((w, i) => <div key={i} style={{ width: w * 5.6, height: 22, borderRadius: 11, background: "#08090c" }} />)}
      </div>
    ),
    size,
  );
}
