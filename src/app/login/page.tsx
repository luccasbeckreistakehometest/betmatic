import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { langFrom, type SearchProps } from "@/lib/seo";

export const dynamic = "force-dynamic";

const TITLE = { pt: "Entrar", en: "Log in" } as const;

export async function generateMetadata({ searchParams }: SearchProps): Promise<Metadata> {
  const lang = await langFrom(searchParams);
  // Carries return URLs and choices in the query: never worth indexing.
  return { title: TITLE[lang], robots: { index: false, follow: true } };
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm mode="login" />
    </Suspense>
  );
}
