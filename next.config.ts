import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright must stay a real Node dependency — bundling it breaks browser launch.
  serverExternalPackages: ["playwright", "playwright-core"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "a.espncdn.com" }],
  },
};

export default nextConfig;
