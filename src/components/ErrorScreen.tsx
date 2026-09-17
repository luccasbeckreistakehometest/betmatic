"use client";

import Link from "next/link";

/** Shown by error.tsx and global-error.tsx. Both languages: an error page cannot trust routing state. */
export function ErrorScreen({ onRetry, digest }: { onRetry: () => void; digest?: string }) {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl flex-col justify-center px-4 py-16 sm:px-5" data-testid="error-screen">
      <p className="text-[12px] uppercase tracking-[0.18em] text-warn-400">Betmatic</p>
      <h1 className="mt-2 text-[clamp(1.6rem,4vw,2.3rem)] font-semibold tracking-[-0.02em] text-white">Algo deu errado do nosso lado.</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-mist-400">Já registramos o problema. Tente de novo; se continuar, fale com a gente.</p>
      <p lang="en" className="mt-4 text-[14px] leading-relaxed text-mist-500">Something went wrong on our side. We logged it — try again, and contact us if it keeps happening.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={onRetry} className="rounded-lg bg-edge-400 px-4 py-2.5 text-[14px] font-semibold text-ink-950 hover:bg-edge-500">Tentar de novo · Try again</button>
        <Link href="/" className="rounded-lg border border-ink-700 px-4 py-2.5 text-[14px] text-mist-200 hover:border-ink-600">Início · Home</Link>
        <Link href="/contato" className="rounded-lg border border-ink-700 px-4 py-2.5 text-[14px] text-mist-200 hover:border-ink-600">Contato · Contact</Link>
      </div>
      {digest && <p className="nums mt-6 text-[11px] text-mist-600">ref {digest}</p>}
    </main>
  );
}
