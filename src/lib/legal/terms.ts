import type { Lang } from "@/lib/i18n";
import { identityBlock, type LegalDoc } from "@/lib/legal/types";
// The English version lives in its own file; each is written natively, not translated.
import { termsEn } from "@/lib/legal/terms-en";

function pt(): LegalDoc {
  return {
    title: "Termos de uso",
    description: "As regras de uso do Betmatic: o que o serviço é e não é, planos pré-pagos, coins, reembolso, jogo responsável e seus direitos.",
    intro: "Estes termos valem para quem usa o Betmatic — o site, o app e os planos pagos. Ao criar a conta, você confirma que leu e aceita estes termos e a Política de privacidade. Se algo não estiver claro, fale com a gente antes de comprar.",
    sections: [
      { title: "1. Quem somos", body: identityBlock("pt") },
      {
        title: "2. O que o Betmatic é — e o que não é",
        body: [
          "O Betmatic é uma ferramenta de pesquisa e conteúdo sobre apostas esportivas. Ele reúne dados públicos de jogos, calcula probabilidades estimadas e monta bilhetes de exemplo com a chance real ao lado de cada odd.",
          {
            list: [
              "Não somos casa de apostas: não aceitamos apostas, não recebemos nem guardamos dinheiro para apostar e não intermediamos pagamentos para casas de apostas.",
              "Não somos consultoria financeira nem de investimento. Aposta não é investimento nem fonte de renda.",
              "Nenhum conteúdo é promessa ou garantia de resultado. Probabilidades são estimativas e podem errar; resultados passados não garantem resultados futuros.",
              "Os dados vêm de fontes de terceiros e podem estar errados, incompletos ou desatualizados. Confirme a linha na sua casa antes de qualquer decisão.",
            ],
          },
          "A decisão de apostar, onde e quanto, é sempre sua.",
        ],
      },
      {
        title: "3. Quem pode usar",
        body: [
          "O Betmatic é proibido para menores de 18 anos. Ao criar a conta você declara ter 18 anos ou mais. Se soubermos que uma conta pertence a um menor, ela será encerrada.",
          "Cada pessoa pode ter uma conta, de uso pessoal e intransferível. Não crie contas extras para aproveitar o plano grátis ou o programa de indicação.",
        ],
      },
      {
        title: "4. Sua conta",
        body: [
          "Você é responsável por manter sua senha em sigilo. Em Minha conta você pode trocar a senha e desconectar todos os aparelhos. Se suspeitar de acesso indevido, faça isso e fale com a gente.",
          "Podemos suspender ou encerrar contas usadas para fraude, abuso dos limites, automação, revenda do conteúdo ou violação destes termos. Quando possível, avisamos antes e explicamos o motivo.",
        ],
      },
      {
        title: "5. Plano grátis, planos pagos e coins",
        body: [
          {
            list: [
              "Plano grátis: um jogo por dia (você escolhe qual), na faixa de valor. O bilhete que você mesmo gerou aparece na hora; os que já estavam prontos aparecem com 2 horas de atraso.",
              "Planos pagos (Starter, Pro e Max) são pré-pagos por 1, 3, 6 ou 12 meses, com os preços e descontos mostrados na página de planos, em reais. O pagamento é único, feito pelo Mercado Pago, e não há renovação automática.",
              "O período começa quando o Mercado Pago confirma o pagamento. Comprar o mesmo plano de novo soma o novo período ao que falta. Ao trocar de plano durante a vigência, o tempo que sobrou do plano anterior é convertido em dias do novo plano, proporcionalmente ao preço mensal de cada um.",
              "Os bilhetes são montados quando alguém com direito abre o jogo, dentro de limites diários de geração. Se a geração falhar, nada é cobrado; você pode tentar de novo.",
              "Coins pagam análises feitas só para você (hoje, a análise de um bilhete que você montou: 8 coins). Se a análise falhar, os coins voltam. Coins não têm valor em dinheiro, não são transferíveis e só são reembolsáveis nos termos da Política de reembolso. Eles não expiram enquanto a conta existir.",
            ],
          },
          "Preços podem mudar para compras futuras; o que você já pagou não muda.",
        ],
      },
      {
        title: "6. Arrependimento e reembolso",
        body: [
          "Você pode desistir de qualquer compra em até 7 dias, com devolução integral, conforme o art. 49 do Código de Defesa do Consumidor. Os detalhes estão na [Política de reembolso](/reembolso).",
        ],
      },
      {
        title: "7. Programa de indicação",
        body: [
          "Quem se cadastra pelo seu link fica vinculado à sua conta. Quando essa pessoa faz a primeira compra paga, vocês dois recebem coins. Há um limite diário de indicações pagas por pessoa. Indicações falsas, contas em massa ou autoindicação não geram coins, e os coins obtidos assim podem ser removidos.",
        ],
      },
      {
        title: "8. Jogo responsável",
        body: [
          "Oferecemos limites de valor por dia e por semana, lembrete de tempo de uso, aviso de sequência de derrotas e pausa de 7 ou 30 dias, que não pode ser encerrada antes do prazo. Veja também [onde buscar ajuda](/jogo-responsavel).",
          "Não usamos mensagens que prometam lucro, que sugiram recuperar perdas ou que apresentem a aposta como solução financeira.",
        ],
      },
      {
        title: "9. Uso permitido",
        body: [
          "É proibido: copiar ou revender o conteúdo em escala, usar robôs ou raspagem, contornar limites de uso ou de pagamento, compartilhar a conta, tentar acessar áreas ou dados de outras pessoas, ou usar o serviço para qualquer fim ilegal.",
          "A marca, o software e os textos do Betmatic são protegidos. Você pode compartilhar links de bilhetes e da prova pública à vontade.",
        ],
      },
      {
        title: "10. Responsabilidade",
        body: [
          "Trabalhamos para manter o serviço disponível e os cálculos corretos, mas o serviço depende de dados e sistemas de terceiros e pode ter interrupções. Como o Betmatic não aceita apostas e a decisão de apostar é sua, não respondemos por ganhos ou perdas em apostas feitas com base no conteúdo. Isso não afasta os direitos que o Código de Defesa do Consumidor garante a você.",
          "Se uma falha nossa impedir o uso de um plano pago por mais de 72 horas seguidas, estendemos o período pelo tempo perdido ou devolvemos o valor proporcional, à sua escolha.",
        ],
      },
      {
        title: "11. Encerramento",
        body: [
          "Você pode excluir sua conta a qualquer momento em Minha conta. A exclusão apaga seus dados, exceto os registros de pagamento, que guardamos anonimizados pelo prazo da lei. Um plano pago não usado pode ser reembolsado apenas nas condições da Política de reembolso.",
        ],
      },
      {
        title: "12. Mudanças nestes termos",
        body: [
          "Podemos atualizar estes termos. Mudanças relevantes são avisadas no app com antecedência e, quando a lei exigir, pedimos um novo aceite. A data da última atualização fica no topo da página.",
        ],
      },
      {
        title: "13. Lei e foro",
        body: [
          "Estes termos seguem as leis brasileiras, incluindo o Código de Defesa do Consumidor, o Marco Civil da Internet e a Lei Geral de Proteção de Dados. Fica eleito o foro do seu domicílio.",
        ],
      },
    ],
  };
}

export function termsDoc(lang: Lang): LegalDoc {
  return lang === "pt" ? pt() : termsEn();
}
