import type { IconName } from "@/components/Icon";
import type { DictKey, Lang } from "@/lib/i18n";

/**
 * One nav model for the whole product. The rail, the phone's tab bar, every page head and the menu
 * read this file, so a door is named once and renamed once, and none of them can drift.
 *
 * The rail is short on purpose: it carries the doors a reader opens most days. The menu carries
 * every door, including the ones the rail leaves out, plus the features that have no page at all.
 * Nothing is hidden by being left off the rail — it is one tap away in the menu, at every size.
 *
 * Two things every row owes the reader:
 *   · `note` — one line saying what the door is for, in the reader's words, not ours.
 *   · `gate` — what it costs, printed on the row, BEFORE the tap. Nobody should pay a click to
 *     find out a door is locked. Absent means the plan already covers it.
 */

export type Bilingual = { pt: string; en: string };

export interface NavItem {
  href: string;
  /** The English route, when the page is served under two paths (the legal pages). */
  hrefEn?: string;
  /** The label, from the dictionary, so rail, tab bar, page head and menu read the same word. */
  key: DictKey;
  icon: IconName;
  note: Bilingual;
  gate?: Bilingual;
  /** `false` keeps a door off the rail. It never keeps it out of the menu. */
  rail?: boolean;
  admin?: boolean;
  tour?: string;
  testId?: string;
}

/**
 * A feature whose entry is inside something else — a player's name, a price, a settled ticket — so
 * it has no page and cannot have a row. The menu names it at the end of its section and says where
 * it lives, which keeps the list complete without inventing a destination that leads nowhere.
 */
export interface NavHint {
  id: string;
  label: Bilingual;
  note: Bilingual;
  /** Where the reader finds it. */
  where: Bilingual;
  gate?: Bilingual;
}

export interface NavGroup {
  id: string;
  /** The rail's word for the room: one word, because the rail is 56px wide at 768px. */
  label: Bilingual;
  /** What the reader comes here to do. The menu prints it under the room's name. */
  intent: Bilingual;
  items: NavItem[];
  hints?: NavHint[];
}

const PRO: Bilingual = { pt: "Pro", en: "Pro" };
const coins = (n: number): Bilingual => ({ pt: `${n} coins`, en: `${n} coins` });

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "desk",
    label: { pt: "Mesa", en: "Desk" },
    intent: { pt: "Escolher o que apostar hoje", en: "Choose what to bet today" },
    items: [
      // The short list first: what to bet tonight, and how much. Everything else is still here.
      { href: "/app/hoje", key: "navToday", icon: "calendar", tour: "today", note: { pt: "a lista curta da noite, com quanto colocar em cada bilhete", en: "tonight's short list, with how much to put on each ticket" } },
      { href: "/app", key: "navSlate", icon: "grid", gate: { pt: "1 jogo por dia no grátis", en: "1 game a day on free" }, note: { pt: "todos os jogos do dia e os bilhetes de cada um", en: "the day's games and each one's tickets" } },
      { href: "/app/parlays", key: "navParlays", icon: "layers", gate: PRO, note: { pt: "uma múltipla que cruza os jogos da rodada", en: "one parlay across the day's games" } },
      { href: "/app/slip", key: "mySlip", icon: "receipt", gate: coins(8), note: { pt: "cole o bilhete que você montou e veja qual perna é a mais fraca", en: "paste the slip you built and see which leg is the weakest" } },
      { href: "/app/parlays/custom", key: "customParlay", icon: "target", rail: false, gate: coins(12), testId: "menu-custom-parlay", note: { pt: "você diz quanto quer que pague e a gente monta", en: "you name the payout and we build it" } },
    ],
    hints: [
      { id: "alternatives", label: { pt: "Plano B do bilhete", en: "The ticket's plan B" }, note: { pt: "até duas alternativas com a mesma ideia e preço parecido", en: "up to two alternatives with the same idea and a similar price" }, where: { pt: "embaixo de cada bilhete", en: "under each ticket" } },
      { id: "books", label: { pt: "Onde apostar", en: "Where to bet" }, note: { pt: "o melhor preço de cada perna e o link com o bilhete já montado na casa", en: "the best price per leg and a link with the slip already filled in at the book" }, where: { pt: "embaixo de cada perna", en: "under each leg" } },
      { id: "refresh", label: { pt: "Refazer quando a linha mexe", en: "Rebuild when the line moves" }, note: { pt: "remonta os bilhetes do jogo quando a escalação ou o preço muda", en: "rebuilds a game's tickets when the lineup or the price moves" }, where: { pt: "na página do jogo", en: "on the game's page" }, gate: { pt: "Max · 3 por dia", en: "Max · 3 a day" } },
    ],
  },
  {
    id: "bankroll",
    label: { pt: "Banca", en: "Bankroll" },
    intent: { pt: "Ver quanto você ganhou ou perdeu", en: "See what you won or lost" },
    items: [
      { href: "/app/bankroll", key: "bankroll", icon: "wallet", tour: "bankroll", note: { pt: "o que você apostou, o que já liquidou e a sua curva", en: "what you staked, what has settled and your curve" } },
      { href: "/app/track", key: "navTrack", icon: "list-check", note: { pt: "o que o modelo acertou e errou, mercado por mercado", en: "what the model got right and wrong, market by market" } },
      { href: "/app/report", key: "navReport", icon: "bars", note: { pt: "como você apostou: perseguição de perda, madrugada, CLV", en: "how you bet: chasing losses, late nights, CLV" } },
    ],
    hints: [
      { id: "scan", label: { pt: "Mandar o print", en: "Send the screenshot" }, note: { pt: "manda a foto do bilhete da casa e ele entra na banca sozinho", en: "send a photo of the book's slip and it lands in the bankroll by itself" }, where: { pt: "dentro de Minha banca", en: "inside My bankroll" }, gate: { pt: "3 por dia no grátis", en: "3 a day on free" } },
      { id: "review", label: { pt: "Por que eu perdi", en: "Why I lost" }, note: { pt: "a leitura do que derrubou um bilhete que já liquidou", en: "the read on what took down a ticket that has settled" }, where: { pt: "no bilhete perdido, na banca", en: "on a lost ticket, in the bankroll" } },
      { id: "lineup", label: { pt: "Vigia de escalação", en: "Lineup watch" }, note: { pt: "jogador que virou banco vira selo vermelho na perna", en: "a player sent to the bench turns into a red badge on the leg" }, where: { pt: "nos bilhetes que você salvou, uma hora antes", en: "on the tickets you saved, an hour before" } },
    ],
  },
  {
    id: "market",
    label: { pt: "Mercado", en: "Market" },
    intent: { pt: "Conferir os números antes de confiar", en: "Check the numbers before trusting them" },
    items: [
      { href: "/app/alerts", key: "navAlerts", icon: "bell", tour: "alerts", note: { pt: "siga times e receba os bilhetes deles no Telegram", en: "follow teams and get their tickets on Telegram" } },
      { href: "/app/tipster", key: "navTipster", icon: "target", gate: { pt: "1 por mês no grátis", en: "1 a month on free" }, note: { pt: "o acerto real de um tipster antes de você pagar o VIP dele", en: "a tipster's real record before you pay for his VIP" } },
      { href: "/app/ranking", key: "navRanking", icon: "trophy", note: { pt: "como vão os membros que escolheram aparecer, sob apelido", en: "how the members who chose to appear are doing, under a handle" } },
      { href: "/prova", key: "navProof", icon: "shield", rail: false, testId: "menu-proof", note: { pt: "nosso histórico aberto, com o preço que pegamos contra o fechamento", en: "our record in the open, our price against the close" } },
      { href: "/ferramentas", key: "navTools", icon: "sliders", rail: false, note: { pt: "EV, múltipla e conversor de odds, sem precisar entrar", en: "EV, parlay and odds converter, no sign-in" } },
    ],
    hints: [
      { id: "live", label: { pt: "Painel ao vivo", en: "Live panel" }, note: { pt: "com o jogo rolando, cada perna com a chance que ainda resta", en: "while the game runs, every leg with the chance it has left" }, where: { pt: "na página do jogo", en: "on the game's page" } },
      { id: "quarter", label: { pt: "Leitura do quarto", en: "The quarter read" }, note: { pt: "bilhetes novos montados do placar de agora, a cada quarto", en: "fresh tickets built from the current score, every quarter" }, where: { pt: "na página do jogo", en: "on the game's page" }, gate: PRO },
      { id: "player", label: { pt: "Raio-x do jogador", en: "Player deep dive" }, note: { pt: "qualquer linha, minutagem e o rendimento com e sem cada companheiro", en: "any line, minutes and how he does with and without each teammate" }, where: { pt: "toque no nome do jogador, na perna", en: "tap the player's name, on a leg" }, gate: { pt: "1 por dia no grátis", en: "1 a day on free" } },
    ],
  },
  {
    id: "account",
    label: { pt: "Conta", en: "Account" },
    intent: { pt: "Seu plano, seus limites, seus dados", en: "Your plan, your limits, your data" },
    items: [
      { href: "/app/settings", key: "navSettings", icon: "sliders", tour: "settings", note: { pt: "teto por dia, lembrete de tempo de uso e pausa", en: "a daily ceiling, a time reminder and a pause" } },
      { href: "/app/conta", key: "navAccount", icon: "user", note: { pt: "plano, coins, pagamentos e seus dados", en: "plan, coins, payments and your data" } },
      { href: "/app/referral", key: "referral", icon: "gift", note: { pt: "5 coins pra cada lado quando quem você indicou assina", en: "5 coins each way when the person you invited subscribes" } },
      { href: "/planos", key: "navPlans", icon: "tag", note: { pt: "o que cada plano abre e os pacotes de coins", en: "what each plan opens and the coin packs" } },
      { href: "/contato", key: "contact", icon: "info", rail: false, note: { pt: "uma dúvida, um erro, uma ideia", en: "a question, a bug, an idea" } },
      { href: "/jogo-responsavel", hrefEn: "/responsible-gambling", key: "navHelp", icon: "lock", rail: false, note: { pt: "onde buscar ajuda e como o app te segura", en: "where to get help and how the app holds you back" } },
      { href: "/admin", key: "navAdmin", icon: "shield", rail: false, admin: true, note: { pt: "operação, usuários, custos e prompts", en: "ops, users, costs and prompts" } },
    ],
  },
];

/** The route this item points at in the reader's language. */
export const hrefFor = (item: Pick<NavItem, "href" | "hrefEn">, lang: Lang): string =>
  lang === "en" && item.hrefEn ? item.hrefEn : item.href;

/**
 * The rail's own list: the same groups, minus the doors marked off the rail and the admin one. The
 * rail stays short and the menu stays complete, and both read this one array.
 */
export const RAIL_GROUPS: { label: Bilingual; items: NavItem[] }[] = NAV_GROUPS
  .map((group) => ({ label: group.label, items: group.items.filter((item) => item.rail !== false && !item.admin) }))
  .filter((group) => group.items.length > 0);

/** Every door, flat, so a page can name itself from its own route. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export const groupOf = (href: string): NavGroup | undefined => NAV_GROUPS.find((g) => g.items.some((i) => i.href === href));
export const itemOf = (href: string): NavItem | undefined => NAV_ITEMS.find((i) => i.href === href);
