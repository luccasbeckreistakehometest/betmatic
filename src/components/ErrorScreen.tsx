"use client";

import Link from "next/link";

/** Shown by error.tsx and global-error.tsx. Both languages: an error page cannot trust routing state. */
export function ErrorScreen({ onRetry, digest }: { onRetry: () => void; digest?: string }) {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-measure flex-col justify-center px-4 py-16 sm:px-6" data-testid="error-screen">
      <p className="text-label u-label text-fg-dim">Betmatic</p>
      <h1 className="mt-2 u-display text-display text-fg">Algo deu errado do nosso lado.</h1>
      <p className="mt-2 text-base leading-relaxed text-fg-muted">Já registramos o problema. Tente de novo; se continuar, fale com a gente.</p>
      <p lang="en" className="mt-4 text-base leading-relaxed text-fg-dim">Something went wrong on our side. We logged it — try again, and contact us if it keeps happening.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={onRetry} className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap bg-action text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover active:bg-action-active disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-faint">Tentar de novo · Try again</button>
        <Link href="/" className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap border border-line-control text-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-surface-2 active:bg-surface-3 disabled:cursor-not-allowed disabled:border-line disabled:text-fg-faint">Início · Home</Link>
        <Link href="/contato" className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap border border-line-control text-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-surface-2 active:bg-surface-3 disabled:cursor-not-allowed disabled:border-line disabled:text-fg-faint">Contato · Contact</Link>
      </div>
      {digest && <p className="nums mt-6 text-label text-fg-faint">ref {digest}</p>}
    </main>
  );
}
