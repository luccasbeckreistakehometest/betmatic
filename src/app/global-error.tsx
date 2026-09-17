"use client";

import "./globals.css";
import { ErrorScreen } from "@/components/ErrorScreen";

/** Replaces the root layout when it fails, so it brings its own <html> and <body>. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-full bg-ink-950 text-mist-100 antialiased">
        <title>Betmatic — erro</title>
        <ErrorScreen onRetry={retry} digest={error.digest} />
      </body>
    </html>
  );
}
