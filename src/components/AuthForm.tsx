"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import { normaliseLang } from "@/lib/i18n";

const COPY = {
  pt: {
    loginTitle: "Entrar",
    signupTitle: "Criar conta",
    signupSub: "Grátis, sem cartão. Um jogo por dia pra você conferir os números.",
    name: "Nome",
    email: "E-mail",
    password: "Senha",
    passwordHint: "Mínimo de 8 caracteres",
    submitLogin: "Entrar",
    submitSignup: "Criar conta",
    toSignup: "Não tem conta? Criar agora",
    toLogin: "Já tem conta? Entrar",
    working: "Aguarde…",
  },
  en: {
    loginTitle: "Log in",
    signupTitle: "Create account",
    signupSub: "Free, no card. One game a day so you can check the numbers.",
    name: "Name",
    email: "Email",
    password: "Password",
    passwordHint: "At least 8 characters",
    submitLogin: "Log in",
    submitSignup: "Create account",
    toSignup: "No account? Create one",
    toLogin: "Already have an account? Log in",
    working: "Working…",
  },
} as const;

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const lang = normaliseLang(params.get("lang"));
  const c = COPY[lang];
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode === "login" ? "login" : "register"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "login" ? { email, password } : { name, email, password, lang }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Falhou");
        return;
      }
      router.push(result.role === "admin" ? "/admin" : `/app?lang=${lang}`);
      router.refresh();
    } catch {
      setError("Erro de rede");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5 text-[14px] text-mist-100 outline-none transition placeholder:text-mist-600 focus:border-edge-400";

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <Link href="/" className="mb-8 w-fit">
        <Logo size={28} />
      </Link>
      <h1 className="text-[1.7rem] font-semibold tracking-[-0.02em] text-white">
        {mode === "login" ? c.loginTitle : c.signupTitle}
      </h1>
      {mode === "signup" && <p className="mt-2 text-[13.5px] leading-relaxed text-mist-400">{c.signupSub}</p>}

      <form onSubmit={submit} className="mt-7 flex flex-col gap-3.5">
        {mode === "signup" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-mist-400">{c.name}</span>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-mist-400">{c.email}</span>
          <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-mist-400">{c.password}</span>
          <input
            className={field}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "signup" ? 8 : undefined}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
          {mode === "signup" && <span className="text-[11px] text-mist-600">{c.passwordHint}</span>}
        </label>

        {error && <p className="text-[12.5px] text-alert-400">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-2 rounded-lg bg-edge-400 px-4 py-2.5 text-[14px] font-semibold text-ink-950 transition hover:bg-edge-500 disabled:opacity-50"
        >
          {busy ? c.working : mode === "login" ? c.submitLogin : c.submitSignup}
        </button>
      </form>

      <Link
        href={mode === "login" ? `/signup?lang=${lang}` : `/login?lang=${lang}`}
        className="mt-5 text-[13px] text-mist-400 transition hover:text-mist-100"
      >
        {mode === "login" ? c.toSignup : c.toLogin}
      </Link>
    </div>
  );
}
