"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import { normaliseLang } from "@/lib/i18n";
import { getCoinPack, getPlan, PERIOD, PREPAID_NOTE, periodPrice, type BillingPeriod } from "@/lib/plans";
import { formatMoneyBRL } from "@/lib/format";
import { buttonClass } from "@/components/ui";

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
    } catch {
      // handled below: the account exists either way, so the buyer continues on the plans page
    }
    // The account was created; the plans page says the payment did not start and offers it again.
    router.push(`/planos?lang=${lang}${plan ? `&period=${period}` : ""}&checkout=falhou`);
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
        // HOME_TODAY decides whether a login opens the short list or the full desk (src/lib/env.ts).
        : next ?? (result.role === "admin" ? "/admin" : `${typeof result.home === "string" && result.home.startsWith("/app") ? result.home : "/app"}?lang=${lang}`);
      router.push(destination);
      router.refresh();
    } catch {
      setError(c.network);
      setBusy(false);
    }
  }

  // 16px text so iOS never zooms the page into the field; the row height is the touch target on a phone.
  const field =
    "w-full min-h-(--row-h) rounded-control border border-line-control bg-surface-1 px-3 py-2.5 text-base text-fg transition-colors duration-(--dur-1) ease-(--ease-out) placeholder:text-fg-dim";

  const choice = plan
    ? c.chosenPlan.replace("{plan}", plan.name).replace("{period}", PERIOD[period].label[lang]).replace("{price}", formatMoneyBRL(periodPrice(plan.monthlyPrice, period), lang))
    : pack
      ? c.chosenPack.replace("{coins}", String(pack.coins + pack.bonus)).replace("{price}", formatMoneyBRL(pack.price, lang))
      : null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <Link href={lang === "en" ? "/?lang=en" : "/"} className="mb-8 w-fit max-md:flex max-md:min-h-11 max-md:items-center" aria-label="Betmatic">
        <Logo size={28} />
      </Link>
      <h1 className="u-title text-h3 text-fg">
        {mode === "login" ? c.loginTitle : c.signupTitle}
      </h1>
      {mode === "signup" && <p className="mt-2 text-sm leading-relaxed text-fg-muted">{c.signupSub}</p>}
      {choice && (
        <p className="mt-4 rounded-control border border-pos bg-action px-3 py-2.5 text-sm leading-relaxed text-fg" data-testid="auth-choice">
          {choice} <span className="text-fg-muted">{PREPAID_NOTE[lang]}</span>
        </p>
      )}

      <form onSubmit={submit} className="mt-7 flex flex-col gap-3.5">
        {mode === "signup" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-tiny text-fg-muted">{c.name}</span>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" enterKeyHint="next" data-testid="auth-name" />
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-tiny text-fg-muted">{c.email}</span>
          <input className={field} type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" data-testid="auth-email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-tiny text-fg-muted">{c.password}</span>
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
            enterKeyHint={mode === "login" ? "go" : "next"}
          />
          {mode === "signup" && <span className="text-label text-fg-dim">{c.passwordHint}</span>}
        </label>

        {mode === "signup" && (
          <>
            {/* Honeypot: hidden from people, filled by bots. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>Deixe em branco<input tabIndex={-1} type="text" autoComplete="new-password" data-lpignore="true" data-1p-ignore value={website} onChange={(e) => setWebsite(e.target.value)} name="bm_hp_field" /></label>
            </div>
            <label className="mt-1 flex items-start gap-2.5 text-tiny leading-relaxed text-fg-muted">
              <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="u-hit mt-[3px] size-4 shrink-0 appearance-none rounded-control border border-line-control bg-surface-3 checked:border-action checked:bg-action" data-testid="auth-consent" />
              <span>
                {c.consentBefore}
                <Link href={lang === "en" ? "/terms" : "/termos"} target="_blank" className="text-fg underline decoration-line-control underline-offset-2 hover:decoration-fg">{c.terms}</Link>
                {c.and}
                <Link href={lang === "en" ? "/privacy" : "/privacidade"} target="_blank" className="text-fg underline decoration-line-control underline-offset-2 hover:decoration-fg">{c.privacy}</Link>
                {c.consentAfter}
              </span>
            </label>
          </>
        )}

        {error && <p className="text-tiny text-neg" role="alert" data-testid="auth-error">{error}</p>}

        <button
          type="submit"
          data-testid="auth-submit"
          disabled={!!busy || (mode === "signup" && !consent)}
          className={buttonClass("primary", "mt-2")}
        >
          {busy === "checkout" ? c.toCheckout : busy ? c.working : mode === "login" ? c.submitLogin : c.submitSignup}
        </button>
      </form>

      <Link
        href={`${mode === "login" ? "/signup" : "/login"}?${carry.toString()}`}
        className="mt-5 w-fit text-sm text-fg-muted transition-colors duration-(--dur-1) ease-(--ease-out) hover:text-fg max-md:inline-flex max-md:min-h-11 max-md:items-center"
      >
        {mode === "login" ? c.toSignup : c.toLogin}
      </Link>
      {mode === "login" && (
        <Link href={`/contato?lang=${lang}&topic=account`} className="mt-3 w-fit text-tiny text-fg-dim transition-colors duration-(--dur-1) ease-(--ease-out) hover:text-fg max-md:mt-1 max-md:inline-flex max-md:min-h-11 max-md:items-center">
          {c.forgot}
        </Link>
      )}
    </div>
  );
}
