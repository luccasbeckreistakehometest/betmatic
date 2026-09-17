/** Copy for "Manda o print", written separately in each language. */
export const SCAN_COPY = {
  pt: {
    button: "Mandar print do bilhete", hint: "Fez o bilhete na casa? Manda o print: ele entra na sua banca e, quando der para conferir no placar, é liquidado sozinho. A imagem não fica guardada.",
    reading: "Lendo o print…", review: "Confere o que a gente leu", reviewHint: "Toque em qualquer campo para corrigir. Nada é salvo até você confirmar.",
    book: "Casa", type: "Tipo", types: { single: "Simples", multiple: "Múltipla", bet_builder: "Criar Aposta" } as Record<string, string>, stake: "Valor apostado", total: "Odd total", ret: "Retorno potencial",
    event: "Jogo", selection: "Seleção", market: "Mercado", odds: "Odd", found: "jogo encontrado", auto: "liquidação automática", manual: "você marca o resultado", notFound: "não achamos esse jogo — fica para você marcar",
    save: "Salvar na banca", saving: "Salvando…", saved: "Salvo na banca.", seeBankroll: "Ver a banca", analyse: "Analisar este bilhete",
    cancel: "Descartar", unreadable: "Não deu para ler", limitNotice: "Esse valor passa do teto que você definiu. O bilhete foi salvo porque já está feito — vale rever o seu limite.",
    manualFallback: "A leitura automática está indisponível agora. Use o lançamento manual.", uses: "{used} de {limit} prints hoje", checks: "Conferência",
    share: "Conferi meu bilhete no Betmatic.", privacy: "O print é lido e descartado na hora; só o texto do bilhete fica, e só se você salvar.",
  },
  en: {
    button: "Send a slip screenshot", hint: "Placed the bet at the book? Send the screenshot: it goes into your bankroll and, when the score can be checked, it is graded by itself. The image is not kept.",
    reading: "Reading the screenshot…", review: "Check what we read", reviewHint: "Tap any field to fix it. Nothing is saved until you confirm.",
    book: "Book", type: "Type", types: { single: "Single", multiple: "Parlay", bet_builder: "Bet builder" } as Record<string, string>, stake: "Stake", total: "Total odds", ret: "Potential return",
    event: "Game", selection: "Selection", market: "Market", odds: "Odds", found: "game found", auto: "graded automatically", manual: "you grade it", notFound: "couldn't find this game — you grade it",
    save: "Save to bankroll", saving: "Saving…", saved: "Saved to your bankroll.", seeBankroll: "See the bankroll", analyse: "Analyse this slip",
    cancel: "Discard", unreadable: "Couldn't read", limitNotice: "This stake is over the ceiling you set. The slip was saved because the bet is already placed — worth reviewing your limit.",
    manualFallback: "Automatic reading is unavailable right now. Use the manual entry.", uses: "{used} of {limit} screenshots today", checks: "Checks",
    share: "I checked my slip on Betmatic.", privacy: "The screenshot is read and discarded at once; only the slip's text is kept, and only if you save.",
  },
} as const;
