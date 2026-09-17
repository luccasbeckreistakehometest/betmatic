"use client";

import { ErrorScreen } from "@/components/ErrorScreen";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen onRetry={retry} digest={error.digest} />;
}
