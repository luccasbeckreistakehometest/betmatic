import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Caddy terminates TLS; the header is still only honoured by browsers over HTTPS.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Playwright must stay a real Node dependency — bundling it breaks browser launch.
  serverExternalPackages: ["playwright", "playwright-core"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "a.espncdn.com" }],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      // Tennis is not sold (no price feed). Its old funnel pages send visitors to the home page.
      { source: "/tenis", destination: "/", permanent: false },
      { source: "/tennis", destination: "/?lang=en", permanent: false },
      // Mercado Pago return URLs from before the payment pages existed.
      { source: "/planos/falhou", destination: "/pagamento/falhou", permanent: false },
    ];
  },
};

export default nextConfig;
