import type { Lang } from "@/lib/i18n";
import { controllerName, identityBlock, type LegalDoc } from "@/lib/legal/types";
import { privacyEn } from "@/lib/legal/privacy-en";

function pt(): LegalDoc {
  return {
    title: "Política de privacidade",
    description: "Como o Betmatic trata seus dados pessoais segundo a LGPD: o que coletamos, por quê, com quem compartilhamos, por quanto tempo e como exercer seus direitos.",
    intro: "Esta política explica, em linguagem direta, como tratamos dados pessoais no Betmatic, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018). Coletamos o mínimo necessário para o serviço funcionar e não vendemos dados.",
    sections: [
      { title: "1. Controlador e contato", body: [...identityBlock("pt"), `O controlador dos dados é ${controllerName("pt")}. O mesmo canal atende como encarregado (DPO) para assuntos de proteção de dados.`] },
      {
        title: "2. Dados que tratamos",
        body: [
          {
            list: [
              "Cadastro: nome, e-mail, senha (guardada só como hash scrypt — ninguém consegue lê-la), idioma e a data em que você aceitou os termos e confirmou ter 18 anos ou mais.",
              "Uso do serviço: jogos que você abriu e escolheu no dia, bilhetes gerados a seu pedido, sua banca (apostas que você mesmo registrou), bilhetes analisados, times e ligas que você segue, avisos, ajustes de jogo responsável (limites, lembretes, pausa), participação opcional no ranking e o progresso do tour de primeiro acesso.",
              "Pagamentos: plano ou pacote comprado, valor, status e o número do pagamento no Mercado Pago. Não recebemos nem guardamos dados de cartão — isso fica com o Mercado Pago.",
              "Prints de bilhete (\"Manda o print\"): a imagem é lida na hora e descartada, nunca é gravada. Só o texto do bilhete (jogo, seleção, odd, valor) fica na sua banca, e só se você salvar.",
              "Raio-x do tipster: o texto colado e os prints são descartados depois da leitura. Ficam só os palpites extraídos, o relatório e o nome que você deu, visíveis apenas para você e apagáveis a qualquer momento.",
              "Medição de uso: páginas visitadas e ações no app (por exemplo, abrir um jogo ou salvar um bilhete), com um identificador aleatório em cookie próprio e a campanha de origem (UTM ou site que trouxe você). Não guardamos IP e não usamos ferramentas de terceiros.",
              "Telegram (só se você conectar): o identificador do chat e o nome de usuário.",
              "Contato: nome, e-mail e a mensagem que você enviar pelo formulário.",
              "Dados técnicos: endereço IP e informações do navegador, usados em memória para limitar abusos e registrados em logs do servidor com rotação automática.",
            ],
          },
          "Não pedimos CPF, endereço ou documentos, e não tratamos dados sensíveis.",
        ],
      },
      {
        title: "3. Para que usamos e com qual base legal",
        body: [
          {
            list: [
              "Criar e manter sua conta, liberar o plano, montar e mostrar os bilhetes, a banca e os avisos — execução do contrato (art. 7º, V).",
              "Registrar pagamentos, emitir comprovantes e atender o fisco — cumprimento de obrigação legal (art. 7º, II) e execução do contrato.",
              "Segurança, prevenção de fraude e de abuso (limites de tentativas, detecção de contas em massa) e melhoria do produto com números agregados — legítimo interesse (art. 7º, IX), sempre com o mínimo de dados.",
              "Alertas pelo Telegram e participação no ranking — consentimento (art. 7º, I), que você pode retirar a qualquer momento nos ajustes.",
              "Responder mensagens de contato e pedidos de titulares — execução do contrato, legítimo interesse ou obrigação legal, conforme o assunto.",
            ],
          },
        ],
      },
      {
        title: "4. Com quem compartilhamos",
        body: [
          "Só com fornecedores necessários para o serviço funcionar, que tratam os dados em nosso nome:",
          {
            list: [
              "Anthropic (inteligência artificial): recebe os dados dos jogos, o texto dos bilhetes que você pede para analisar, os prints de bilhete e as mensagens de tipster que você envia para leitura. Não enviamos seu nome nem seu e-mail.",
              "Mercado Pago: processa os pagamentos e recebe o e-mail do comprador.",
              "Hostinger: hospeda o servidor onde ficam o banco de dados e os logs.",
              "Telegram: entrega os alertas, se você conectar a conta.",
              "Meta (WhatsApp): apenas se você nos procurar pelo WhatsApp ou usar o botão de compartilhar, que abre o seu próprio aplicativo.",
            ],
          },
          "Também podemos compartilhar dados quando a lei ou uma ordem de autoridade exigir.",
        ],
      },
      {
        title: "5. Transferência internacional",
        body: [
          "Alguns fornecedores processam dados fora do Brasil (por exemplo, a Anthropic nos Estados Unidos, e o datacenter da hospedagem pode ficar fora do país). Essas transferências seguem o art. 33 da LGPD, com contratos que exigem proteção equivalente à da lei brasileira.",
        ],
      },
      {
        title: "6. Por quanto tempo guardamos",
        body: [
          {
            list: [
              "Dados da conta e de uso: enquanto a conta existir. Ao excluir a conta, eles são apagados na hora.",
              "Registros de pagamento: 5 anos, pelas obrigações fiscais; se você excluir a conta, ficam anonimizados (sem nome nem e-mail).",
              "Mensagens de contato: até 12 meses depois de resolvidas.",
              "Progresso do tour de visitantes sem conta: até 12 meses.",
              "Eventos de medição de uso: 180 dias, depois são apagados automaticamente.",
              "Logs técnicos do servidor: rotação automática, por poucas semanas.",
            ],
          },
          "O histórico público de bilhetes (a prova) não contém dados pessoais.",
        ],
      },
      {
        title: "7. Seus direitos e como exercê-los",
        body: [
          "A LGPD (art. 18) garante: confirmação de que tratamos seus dados, acesso, correção, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade, informação sobre com quem compartilhamos, revogação do consentimento e revisão de decisões automatizadas.",
          {
            list: [
              "Em Minha conta você baixa uma cópia dos seus dados (JSON) e exclui a conta sozinho, na hora.",
              "Para o resto, use o [formulário de contato](/contato?topic=privacy). Respondemos em até 15 dias.",
              "Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD), em gov.br/anpd.",
            ],
          },
        ],
      },
      {
        title: "8. Segurança",
        body: [
          "Usamos conexão criptografada (HTTPS), senhas com hash scrypt, sessões que você pode revogar, limites de tentativas de login e acesso administrativo restrito. Nenhum sistema é infalível: se houver um incidente que possa trazer risco a você, avisaremos você e a ANPD.",
        ],
      },
      {
        title: "9. Cookies",
        body: ["Usamos cookies essenciais e um cookie de medição de uso próprio, sem IP — detalhes na [Política de cookies](/cookies). Não usamos cookies de publicidade nem de rastreamento de terceiros."],
      },
      {
        title: "10. Menores de idade",
        body: ["O Betmatic é proibido para menores de 18 anos. Se identificarmos dados de um menor, eles serão excluídos."],
      },
      {
        title: "11. Mudanças",
        body: ["Quando esta política mudar de forma relevante, avisaremos no app. A data da última atualização fica no topo da página."],
      },
    ],
  };
}

export function privacyDoc(lang: Lang): LegalDoc {
  return lang === "pt" ? pt() : privacyEn();
}
