import type { Lang } from "@/lib/i18n";
import type { LegalDoc } from "@/lib/legal/types";

/**
 * Support resources were checked on 2026-09-17: CVV (cvv.org.br, 188, free, 24 h, chat and email),
 * the federal self-exclusion platform (autoexclusaoapostas.fazenda.gov.br, linked from gov.br/fazenda),
 * the SUS health network (CAPS/UBS, Disque Saúde 136, cited on the same gov.br page), Jogadores
 * Anônimos do Brasil (jogadoresanonimos.com.br), NCPG's helpline (1-800-MY-RESET, ncpgambling.org)
 * and GamCare (0808 8020 133, gamcare.org.uk).
 */
const PT: () => LegalDoc = () => ({
  title: "Jogo responsável",
  description: "Aposta é entretenimento, não renda. Sinais de alerta, as ferramentas de limite do Betmatic e onde buscar ajuda gratuita no Brasil.",
  intro: "Apostar deve ser diversão com dinheiro que você pode perder sem fazer falta. O Betmatic mostra a chance real justamente para que ninguém confunda aposta com investimento. Se deixou de ser diversão, pare e procure ajuda — é gratuita e sigilosa.",
  sections: [
    {
      title: "Sinais de alerta",
      body: [
        {
          list: [
            "Apostar para recuperar o que perdeu.",
            "Apostar mais do que tinha planejado, ou dinheiro de contas, dívidas ou de outras pessoas.",
            "Esconder apostas de família e amigos, ou mentir sobre quanto gasta.",
            "Sentir ansiedade, irritação ou culpa quando não está apostando.",
            "Deixar trabalho, estudo, sono ou família de lado por causa das apostas.",
          ],
        },
        "Se você se reconheceu em um desses pontos, vale conversar com alguém agora.",
      ],
    },
    {
      title: "Ferramentas no Betmatic",
      body: [
        "Em [Ajustes](/app/settings) você encontra: teto de valor em 24 horas e em 7 dias, lembrete de tempo de uso, aviso depois de uma sequência de derrotas e uma pausa de 7 ou 30 dias. A pausa esconde os bilhetes, trava a banca e não pode ser encerrada antes do prazo — nem por você, nem por nós.",
        "Se preferir encerrar de vez, você pode excluir a conta em Minha conta.",
      ],
    },
    {
      title: "Autoexclusão nas casas de apostas",
      body: [
        "O governo federal mantém a Plataforma Centralizada de Autoexclusão, que bloqueia seu CPF em todas as casas de apostas autorizadas no Brasil de uma só vez, por 1 a 12 meses. O acesso é com a conta gov.br: [autoexclusaoapostas.fazenda.gov.br](https://autoexclusaoapostas.fazenda.gov.br/).",
        "O Betmatic não é casa de apostas; a pausa acima vale para o nosso app, e a plataforma do governo vale para as casas.",
      ],
    },
    {
      title: "Onde buscar ajuda",
      body: [
        {
          list: [
            "CVV — Centro de Valorização da Vida: ligue 188, de graça, 24 horas, ou converse por chat e e-mail em [cvv.org.br](https://cvv.org.br/).",
            "SUS: os Centros de Atenção Psicossocial (CAPS) e as Unidades Básicas de Saúde (UBS) atendem casos de dependência em jogos. Informações pelo Disque Saúde 136.",
            "Jogadores Anônimos do Brasil: grupos gratuitos de apoio, presenciais e online, em [jogadoresanonimos.com.br](https://www.jogadoresanonimos.com.br/).",
          ],
        },
        "Em uma emergência, ligue 192 (SAMU).",
      ],
    },
    {
      title: "Menores de idade",
      body: ["Apostas são proibidas para menores de 18 anos, e o Betmatic também. Se uma criança ou adolescente usa o seu aparelho, use o controle parental do sistema e não deixe a conta conectada."],
    },
  ],
});

const EN: () => LegalDoc = () => ({
  title: "Responsible gambling",
  description: "Betting is entertainment, not income. Warning signs, Betmatic's limit tools and where to get free, confidential help.",
  intro: "Betting should be fun with money you can afford to lose. Betmatic shows the real probability precisely so nobody mistakes betting for investing. If it has stopped being fun, stop and reach out — help is free and confidential.",
  sections: [
    {
      title: "Warning signs",
      body: [
        {
          list: [
            "Betting to win back what you lost.",
            "Staking more than you planned, or money meant for bills, debts or other people.",
            "Hiding bets from family and friends, or lying about how much you spend.",
            "Feeling anxious, irritable or guilty when you are not betting.",
            "Neglecting work, study, sleep or family because of betting.",
          ],
        },
        "If any of these sounds familiar, talk to someone today.",
      ],
    },
    {
      title: "Tools in Betmatic",
      body: [
        "Under [Settings](/app/settings?lang=en) you'll find: 24-hour and 7-day stake ceilings, a time reminder, a notice after a losing streak, and a 7- or 30-day pause. The pause hides tickets, locks the bankroll and cannot be lifted early — not by you, not by us.",
        "If you'd rather stop for good, you can delete your account under My account.",
      ],
    },
    {
      title: "Where to get help",
      body: [
        {
          list: [
            "United States — National Problem Gambling Helpline: call or text 1-800-MY-RESET, or chat via [ncpgambling.org](https://www.ncpgambling.org/help-treatment/).",
            "United Kingdom — GamCare's National Gambling Helpline: 0808 8020 133, free, 24/7, with live chat at [gamcare.org.uk](https://www.gamcare.org.uk/).",
            "Brazil — CVV: call 188, free, 24 hours, or chat at [cvv.org.br](https://cvv.org.br/); the federal self-exclusion platform blocks your CPF at every licensed sportsbook: [autoexclusaoapostas.fazenda.gov.br](https://autoexclusaoapostas.fazenda.gov.br/).",
          ],
        },
        "Elsewhere, your national health service or a local gambling-support charity can help. In an emergency, call your local emergency number.",
      ],
    },
    {
      title: "Minors",
      body: ["Betting is for adults only, and so is Betmatic. If a child uses your device, turn on parental controls and don't stay signed in."],
    },
  ],
});

export function responsibleDoc(lang: Lang): LegalDoc {
  return lang === "pt" ? PT() : EN();
}
