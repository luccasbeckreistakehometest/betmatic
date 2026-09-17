import { NextResponse } from "next/server";
import type { LimitResult } from "@/lib/server/rate-limit";

export type ApiLang = "pt" | "en";

/**
 * Every message an API route shows a user, in both languages. Routes return a stable `error` code
 * plus the localized `message`; clients show the message and branch on the code.
 */
const MESSAGES = {
  rate_limited: { pt: "Muitas tentativas em pouco tempo. Espere um pouco e tente de novo.", en: "Too many attempts in a short time. Wait a moment and try again." },
  invalid_input: { pt: "Confira os dados e tente de novo.", en: "Check the details and try again." },
  invalid_credentials: { pt: "E-mail ou senha incorretos.", en: "Wrong email or password." },
  account_disabled: { pt: "Esta conta está desativada. Fale com o suporte pelo formulário de contato.", en: "This account is disabled. Reach support through the contact form." },
  email_taken: { pt: "Já existe uma conta com este e-mail. Tente entrar.", en: "An account with this email already exists. Try logging in." },
  weak_password: { pt: "A senha precisa de pelo menos 8 caracteres.", en: "The password needs at least 8 characters." },
  terms_required: { pt: "Para criar a conta, confirme que tem 18 anos ou mais e aceite os termos e a política de privacidade.", en: "To create an account, confirm you are 18 or older and accept the terms and privacy policy." },
  wrong_password: { pt: "A senha atual não confere.", en: "The current password is wrong." },
  unauthenticated: { pt: "Entre na sua conta para continuar.", en: "Log in to continue." },
  forbidden: { pt: "Você não tem acesso a isso.", en: "You don't have access to this." },
  not_found: { pt: "Não encontrado.", en: "Not found." },
  ai_unavailable: { pt: "A análise está indisponível agora. Tente de novo em alguns minutos.", en: "Analysis is unavailable right now. Try again in a few minutes." },
  ai_budget: { pt: "A geração atingiu o limite de hoje. Volta amanhã — o que já foi gerado continua disponível.", en: "Generation has hit today's limit. Come back tomorrow — everything already built stays available." },
  payments_off: { pt: "Os pagamentos ainda não estão disponíveis. Fale com a gente pelo formulário de contato.", en: "Payments aren't available yet. Reach us through the contact form." },
  checkout_failed: { pt: "Não foi possível abrir o pagamento agora. Tente de novo em instantes.", en: "Couldn't open the payment right now. Try again shortly." },
  insufficient_coins: { pt: "Coins insuficientes para esta ação.", en: "Not enough coins for this action." },
  server_error: { pt: "Algo deu errado do nosso lado. Tente de novo em instantes.", en: "Something went wrong on our side. Try again shortly." },
  game_unavailable: { pt: "Não foi possível carregar este jogo agora.", en: "Couldn't load this game right now." },
  slate_unavailable: { pt: "Não foi possível carregar os jogos agora. Tente de novo em instantes.", en: "Couldn't load the games right now. Try again shortly." },
  paused: { pt: "Sua pausa está ativa.", en: "Your pause is active." },
  player_cap: { pt: "No plano Free dá para abrir o raio-x de 1 jogador por dia. Amanhã libera outro — ou veja os planos.", en: "The Free plan opens the deep dive for 1 player a day. Another one unlocks tomorrow — or see the plans." },
} as const;

export type ApiErrorCode = keyof typeof MESSAGES;

export function apiMessage(code: ApiErrorCode, lang: ApiLang): string {
  return MESSAGES[code][lang];
}

/** Query `lang`, then an explicit hint (body/user), then Accept-Language; Portuguese by default. */
export function requestLang(request: Request, hint?: string | null): ApiLang {
  const fromQuery = new URL(request.url).searchParams.get("lang");
  if (fromQuery === "en" || fromQuery === "pt") return fromQuery;
  if (hint === "en" || hint === "pt") return hint;
  const accept = request.headers.get("accept-language") ?? "";
  return /^en\b/i.test(accept.trim()) ? "en" : "pt";
}

export function apiError(code: ApiErrorCode, lang: ApiLang, status: number, extra: Record<string, unknown> = {}, headers?: HeadersInit): NextResponse {
  return NextResponse.json({ error: code, message: apiMessage(code, lang), ...extra }, { status, headers });
}

export function rateLimited(result: LimitResult, lang: ApiLang): NextResponse {
  return apiError("rate_limited", lang, 429, { retryAfter: result.retryAfterSec }, { "Retry-After": String(result.retryAfterSec) });
}
