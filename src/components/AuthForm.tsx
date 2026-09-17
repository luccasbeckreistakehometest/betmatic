"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import { normaliseLang } from "@/lib/i18n";
import { getCoinPack, getPlan, PERIOD, PREPAID_NOTE, periodPrice, type BillingPeriod } from "@/lib/plans";
import { formatMoneyBRL } from "@/lib/format";

const COPY = {
  pt: {
    loginTitle: "Entrar",
    signupTitle: "Criar conta",
    signupSub: "Grátis, sem cartão. Um jogo por dia, você escolhe qual.",
    name: "Nome",
    email: "E-mail",
    password: "Senha",
    passwordHint: "Mínimo de 8 caracteres",
    submitLogin: "Entrar",
    submitSignup: "Criar conta",
    toSignup: "Não tem conta? Criar agora",
    toLogin: "Já tem conta? Entrar",
    working: "Aguarde…",
    consentBefore: "Tenho 18 anos ou mais e li e aceito os ",
    terms: "Termos de uso",
    and: " e a ",
    privacy: "Política de privacidade",
    consentAfter: ".",
    forgot: "Esqueceu a senha? Fale com o suporte",
    chosenPlan: "Você escolheu o plano {plan} ({period}): {price}. Depois de criar a conta, seguimos para o pagamento no Mercado Pago.",
    chosenPack: "Você escolheu {coins} coins por {price}. Depois de criar a conta, seguimos para o pagamento no Mercado Pago.",
    toCheckout: "Abrindo o pagamento…",
    checkoutFailed: "Conta pronta, mas não deu para abrir o pagamento agora. Tente de novo em Planos.",
    network: "Sem conexão. Confira sua internet e tente de novo.",
    failed: "Não deu certo. Tente de novo.",
  },
  en: {
    loginTitle: "Log in",
    signupTitle: "Create account",
    signupSub: "Free, no card. One game a day, your pick.",
    name: "Name",
    email: "Email",
    password: "Password",
    passwordHint: "At least 8 characters",
    submitLogin: "Log in",
    submitSignup: "Create account",
    toSignup: "No account? Create one",
    toLogin: "Already have an account? Log in",
    working: "Working…",
    consentBefore: "I am 18 or older and I have read and accept the ",
    terms: "Terms of use",
    and: " and the ",
    privacy: "Privacy policy",
    consentAfter: ".",
    forgot: "Forgot your password? Contact support",
    chosenPlan: "You picked the {plan} plan ({period}): {price}. Once your account exists, we take you to Mercado Pago to pay.",
    chosenPack: "You picked {coins} coins for {price}. Once your account exists, we take you to Mercado Pago to pay.",
    toCheckout: "Opening checkout…",
    checkoutFailed: "Your account is ready, but checkout couldn't open right now. Try again under Plans.",
    network: "No connection. Check your internet and try again.",
    failed: "That didn't work. Try again.",
  },
} as const;

const PERIODS = new Set(["monthly", "quarterly", "semiannual", "annual"]);

/** Only same-origin paths survive as a return URL. */
function safeNext(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || value.length > 300) return null;
  return value;
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const lang = normaliseLang(params.get("lang"));
  const c = COPY[lang];
  const next = safeNext(params.get("next"));
  const planParam = params.get("plan");
  const plan = planParam && planParam !== "free" && getPlan(planParam).id === planParam ? getPlan(planParam) : null;
  const periodParam = params.get("period") ?? "monthly";
  const period = (PERIODS.has(periodParam) ? periodParam : "monthly") as BillingPeriod;
  const pack = params.get("pack") ? getCoinPack(params.get("pack")!) ?? null : null;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<false | "auth" | "checkout">(false);

  // Carries the choice (plan, pack, return URL) between the two forms.
  const carry = new URLSearchParams();
  carry.set("lang", lang);
  for (const key of ["next", "plan", "period", "pack", "ref"]) {
    const v = params.get(key);
    if (v) carry.set(key, v);
  }

  async function startCheckout(): Promise<boolean> {
    const body = plan ? { kind: "plan", planId: plan.id, period } : pack ? { kind: "coins", packId: pack.id } : null;
    if (!body) return false;
    setBusy("checkout");
    try {
      const r = await fetch(`/api/billing/checkout?lang=${lang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && typeof j.url === "string" && /^https?:\/\//.test(j.url)) {
        window.location.assign(j.url);
        return true;
      }
      setError(j.message ?? c.checkoutFailed);
    } catch {
      setError(c.checkoutFailed);
    }
    router.push(`/planos?lang=${lang}${plan ? `&period=${period}` : ""}`);
    return true;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy("auth");
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode === "login" ? "login" : "register"}?lang=${lang}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          mode === "login"
            ? { email, password, lang }
            : { name, email, password, lang, acceptTerms: consent ? true : undefined, website: website || undefined },
        ),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.message ?? c.failed);
        setBusy(false);
        return;
      }
      if (await startCheckout()) return;
      const destination = result.mustChangePassword
        ? `/app/conta?lang=${lang}&trocar=1`
        : next ?? (result.role === "admin" ? "/admin" : `/app?lang=${lang}`);
      router.push(destination);
      router.refresh();
    } catch {
      setError(c.network);
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5 text-[14px] text-mist-100 outline-none transition placeholder:text-mist-600 focus:border-edge-400";

  const choice = plan
    ? c.chosenPlan.replace("{plan}", plan.name).replace("{period}", PERIOD[period].label[lang]).replace("{price}", formatMoneyBRL(periodPrice(plan.monthlyPrice, period), lang))
    : pack
      ? c.chosenPack.replace("{coins}", String(pack.coins + pack.bonus)).replace("{price}", formatMoneyBRL(pack.price, lang))
      : null;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-12">
      <Link href={lang === "en" ? "/?lang=en" : "/"} className="mb-8 w-fit" aria-label="Betmatic">
        <Logo size={28} />
      </Link>
      <h1 className="text-[1.7rem] font-semibold tracking-[-0.02em] text-white">
        {mode === "login" ? c.loginTitle : c.signupTitle}
      </h1>
      {mode === "signup" && <p className="mt-2 text-[13.5px] leading-relaxed text-mist-400">{c.signupSub}</p>}
      {choice && (
        <p className="mt-4 rounded-lg border border-edge-400/30 bg-edge-400/5 px-3 py-2.5 text-[13px] leading-relaxed text-mist-200" data-testid="auth-choice">
          {choice} <span className="text-mist-400">{PREPAID_NOTE[lang]}</span>
        </p>
      )}

      <form onSubmit={submit} className="mt-7 flex flex-col gap-3.5">
        {mode === "signup" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-mist-400">{c.name}</span>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" data-testid="auth-name" />
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-mist-400">{c.email}</span>
          <input className={field} type="email" data-testid="auth-email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-mist-400">{c.password}</span>
          <input
            className={field}
            type="password"
            data-testid="auth-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            maxLength={200}
            minLength={mode === "signup" ? 8 : undefined}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
          {mode === "signup" && <span className="text-[11px] text-mist-500">{c.passwordHint}</span>}
        </label>

        {mode === "signup" && (
          <>
            {/* Honeypot: hidden from people, filled by bots. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" /></label>
            </div>
            <label className="mt-1 flex items-start gap-2.5 text-[12.5px] leading-relaxed text-mist-300">
              <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-[3px] size-4 accent-edge-400" data-testid="auth-consent" />
              <span>
                {c.consentBefore}
                <Link href={lang === "en" ? "/terms" : "/termos"} target="_blank" className="text-edge-400 underline-offset-2 hover:underline">{c.terms}</Link>
                {c.and}
                <Link href={lang === "en" ? "/privacy" : "/privacidade"} target="_blank" className="text-edge-400 underline-offset-2 hover:underline">{c.privacy}</Link>
                {c.consentAfter}
              </span>
            </label>
          </>
        )}

        {error && <p className="text-[12.5px] text-alert-400" role="alert" data-testid="auth-error">{error}</p>}

        <button
          type="submit"
          data-testid="auth-submit"
          disabled={!!busy || (mode === "signup" && !consent)}
          className="mt-2 rounded-lg bg-edge-400 px-4 py-2.5 text-[14px] font-semibold text-ink-950 transition hover:bg-edge-500 disabled:opacity-50"
        >
          {busy === "checkout" ? c.toCheckout : busy ? c.working : mode === "login" ? c.submitLogin : c.submitSignup}
        </button>
      </form>

      <Link
        href={`${mode === "login" ? "/signup" : "/login"}?${carry.toString()}`}
        className="mt-5 text-[13px] text-mist-400 transition hover:text-mist-100"
      >
        {mode === "login" ? c.toSignup : c.toLogin}
      </Link>
      {mode === "login" && (
        <Link href={`/contato?lang=${lang}&topic=account`} className="mt-2 text-[12.5px] text-mist-500 transition hover:text-mist-200">
          {c.forgot}
        </Link>
      )}
    </div>
  );
}
