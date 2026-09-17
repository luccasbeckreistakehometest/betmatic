import type { Lang } from "@/lib/i18n";
import type { LegalDoc } from "@/lib/legal/types";

const ROWS = {
  pt: [
    "betmatic_session — mantém você conectado (30 dias). Essencial.",
    "betmatic_anon — guarda o progresso do tour de primeiro acesso para quem ainda não tem conta (12 meses). Essencial para o tour não reaparecer.",
    "bm_ref — lembra quem te indicou, se você chegou por um link de indicação (30 dias).",
    "bm_sport — lembra o último esporte que você abriu no app (12 meses).",
    "bm_aid — identificador aleatório da medição de uso própria do Betmatic, sem IP e sem terceiros (12 meses).",
    "bm_ft — a campanha ou o site que trouxe você na primeira visita, copiado para a conta no cadastro (90 dias).",
    "Armazenamento local (localStorage) — lembra que você fechou o aviso de novidades.",
    "Armazenamento da sessão do navegador (sessionStorage) — conta o tempo de uso para o lembrete de jogo responsável e evita repetir o convite do tour. Some quando você fecha a aba.",
  ],
  en: [
    "betmatic_session — keeps you signed in (30 days). Essential.",
    "betmatic_anon — stores first-visit tour progress for visitors without an account (12 months), so the tour doesn't repeat.",
    "bm_ref — remembers who referred you, if you arrived through a referral link (30 days).",
    "bm_sport — remembers the last sport you opened in the app (12 months).",
    "bm_aid — a random identifier for Betmatic's own usage measurement, with no IP address and no third party (12 months).",
    "bm_ft — the campaign or site that brought you on your first visit, copied to your account at sign-up (90 days).",
    "Local storage (localStorage) — remembers that you closed the what's-new notice.",
    "Browser session storage (sessionStorage) — counts time in the app for the responsible-play reminder and avoids repeating the tour invitation. Cleared when you close the tab.",
  ],
};

export function cookiesDoc(lang: Lang): LegalDoc {
  const pt = lang === "pt";
  return {
    title: pt ? "Política de cookies" : "Cookie notice",
    description: pt
      ? "O Betmatic usa apenas cookies essenciais ao funcionamento do serviço. Sem publicidade e sem rastreamento de terceiros."
      : "Betmatic only uses cookies the service needs to work. No advertising and no third-party tracking.",
    intro: pt
      ? "Usamos só o que o serviço precisa para funcionar, mais uma medição de uso própria, sem IP. Não há cookies de publicidade, de redes sociais nem de análise de terceiros."
      : "We only use what the service needs to work, plus our own usage measurement with no IP address. There are no advertising, social-media or third-party analytics cookies.",
    sections: [
      { title: pt ? "O que guardamos no seu navegador" : "What we store in your browser", body: [{ list: ROWS[lang] }] },
      {
        title: pt ? "Como controlar" : "How to control it",
        body: [
          pt
            ? "Você pode apagar os cookies nas configurações do navegador a qualquer momento. Sem o cookie de sessão, você precisará entrar de novo; sem os outros, o app só esquece essas preferências."
            : "You can clear cookies in your browser settings at any time. Without the session cookie you'll need to log in again; without the others, the app just forgets those preferences.",
          pt ? "Mais detalhes sobre dados pessoais na [Política de privacidade](/privacidade)." : "More on personal data in the [Privacy policy](/privacy).",
        ],
      },
    ],
  };
}
