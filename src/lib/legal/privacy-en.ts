import { controllerName, identityBlock, type LegalDoc } from "@/lib/legal/types";

export function privacyEn(): LegalDoc {
  return {
    title: "Privacy policy",
    description: "How Betmatic handles personal data under Brazil's LGPD: what we collect, why, who we share it with, how long we keep it and how to exercise your rights.",
    intro: "This policy explains plainly how Betmatic handles personal data under Brazil's General Data Protection Law (LGPD, Law 13,709/2018). We collect only what the service needs and we never sell data.",
    sections: [
      { title: "1. Controller and contact", body: [...identityBlock("en"), `The data controller is ${controllerName("en")}. The same channel serves as the data protection officer (DPO) contact.`] },
      {
        title: "2. Data we handle",
        body: [
          {
            list: [
              "Sign-up: name, email, password (stored only as a scrypt hash — nobody can read it), language, and when you accepted the terms and confirmed you are an adult.",
              "Using the service: games you opened and picked for the day, tickets generated at your request, your bankroll (bets you logged yourself), slips you had analysed, teams and leagues you follow, notices, responsible-play settings (limits, reminders, pause), optional leaderboard participation, and first-visit tour progress.",
              "Payments: the plan or pack bought, amount, status and the Mercado Pago payment number. We never receive or store card data — Mercado Pago does.",
              "Slip screenshots (\"Snap your slip\"): the image is read on the spot and discarded, never written anywhere. Only the slip's text (game, selection, odds, stake) goes into your bankroll, and only if you save it.",
              "Tipster audit: the pasted text and screenshots are discarded after reading. Only the extracted picks, the report and the name you gave are kept, visible to you alone and deletable at any time.",
              "Usage measurement: pages visited and actions in the app (such as opening a game or saving a ticket), with a random identifier in our own cookie and the campaign that brought you (UTM or referring site). No IP address is stored and no third-party tool is used.",
              "Telegram (only if you connect it): the chat identifier and username.",
              "Contact: the name, email and message you send through the form.",
              "Technical data: IP address and browser details, used in memory to limit abuse and written to server logs that rotate automatically.",
            ],
          },
          "We don't ask for tax IDs, addresses or documents, and we don't handle sensitive data.",
        ],
      },
      {
        title: "3. Why we use it, and the legal basis",
        body: [
          {
            list: [
              "Creating and running your account, unlocking your plan, building and showing tickets, your bankroll and notices — performance of a contract (art. 7, V).",
              "Recording payments and meeting tax duties — legal obligation (art. 7, II) and performance of a contract.",
              "Security, fraud and abuse prevention (login limits, bulk-account detection) and improving the product with aggregate numbers — legitimate interest (art. 7, IX), always with minimal data.",
              "Telegram alerts and leaderboard participation — consent (art. 7, I), which you can withdraw at any time in settings.",
              "Answering contact messages and data-subject requests — contract, legitimate interest or legal obligation, depending on the subject.",
            ],
          },
        ],
      },
      {
        title: "4. Who we share it with",
        body: [
          "Only with providers the service needs, acting on our behalf:",
          {
            list: [
              "Anthropic (AI): receives game data, the text of slips you ask us to analyse, the slip screenshots and the tipster messages you send for reading. We never send your name or email.",
              "Mercado Pago: processes payments and receives the buyer's email.",
              "Hostinger: hosts the server that holds the database and logs.",
              "Telegram: delivers alerts, if you connect your account.",
              "Meta (WhatsApp): only if you contact us on WhatsApp or use the share button, which opens your own app.",
            ],
          },
          "We may also disclose data when the law or an authority's order requires it.",
        ],
      },
      {
        title: "5. International transfers",
        body: [
          "Some providers process data outside Brazil (for example, Anthropic in the United States, and the hosting datacenter may be abroad). These transfers follow LGPD art. 33, under contracts requiring protection equivalent to Brazilian law.",
        ],
      },
      {
        title: "6. How long we keep it",
        body: [
          {
            list: [
              "Account and usage data: while the account exists. Deleting the account erases them immediately.",
              "Payment records: 5 years, for tax duties; if you delete your account they are kept anonymised (no name or email).",
              "Contact messages: up to 12 months after they are resolved.",
              "Tour progress of visitors without an account: up to 12 months.",
              "Server logs: rotated automatically within a few weeks.",
              "Usage-measurement events: 180 days, then deleted automatically.",
            ],
          },
          "The public ticket record contains no personal data.",
        ],
      },
      {
        title: "7. Your rights and how to use them",
        body: [
          "The LGPD (art. 18) gives you: confirmation that we process your data, access, correction, anonymisation, blocking or deletion of unnecessary data, portability, information about sharing, withdrawal of consent, and review of automated decisions.",
          {
            list: [
              "Under My account you can download a copy of your data (JSON) and delete your account yourself, instantly.",
              "For anything else, use the [contact form](/contato?lang=en&topic=privacy). We reply within 15 days.",
              "You can also complain to Brazil's data protection authority (ANPD) at gov.br/anpd.",
            ],
          },
        ],
      },
      {
        title: "8. Security",
        body: [
          "We use encrypted connections (HTTPS), scrypt password hashes, sessions you can revoke, login attempt limits and restricted admin access. No system is flawless: if an incident could put you at risk, we will tell you and the ANPD.",
        ],
      },
      {
        title: "9. Cookies",
        body: ["We use essential cookies and one first-party usage-measurement cookie with no IP address — see the [Cookie notice](/cookies?lang=en). No advertising or third-party tracking cookies."],
      },
      {
        title: "10. Minors",
        body: ["Betmatic is for adults only. If we find data belonging to a minor, we delete it."],
      },
      {
        title: "11. Changes",
        body: ["If this policy changes materially, we will say so in the app. The last-updated date is at the top of the page."],
      },
    ],
  };
}
