import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const BARS = [8, 14, 19, 11];

/** Home-screen icon: the mark on its own tile, in ink. The brand carries no hue — a green
 *  brand on a betting product implies profit, which Brazilian advertising rules forbid (§6.2). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#edf0f5", display: "flex", flexDirection: "column", justifyContent: "center", gap: 13, paddingLeft: 40 }}>
        {BARS.map((w, i) => <div key={i} style={{ width: w * 5.6, height: 22, borderRadius: 3, background: "#0a0c11" }} />)}
      </div>
    ),
    size,
  );
}
