import { identityBlock, type LegalDoc } from "@/lib/legal/types";

export function termsEn(): LegalDoc {
  return {
    title: "Terms of use",
    description: "The rules for using Betmatic: what the service is and isn't, prepaid plans, coins, refunds, responsible gambling and your rights.",
    intro: "These terms apply to anyone using Betmatic — the website, the app and the paid plans. By creating an account you confirm you have read and accept these terms and the Privacy policy. If anything is unclear, ask us before you buy.",
    sections: [
      { title: "1. Who we are", body: identityBlock("en") },
      {
        title: "2. What Betmatic is — and isn't",
        body: [
          "Betmatic is a research and content tool about sports betting. It gathers public game data, computes estimated probabilities and builds example tickets with the real probability next to every price.",
          {
            list: [
              "We are not a sportsbook: we don't take bets, we don't receive or hold money for betting, and we don't process payments to sportsbooks.",
              "We are not financial or investment advice. Betting is not investing and not a source of income.",
              "Nothing here promises or guarantees a result. Probabilities are estimates and can be wrong; past results don't guarantee future ones.",
              "Data comes from third parties and can be wrong, incomplete or stale. Check the line at your sportsbook before any decision.",
            ],
          },
          "Whether to bet, where and how much is always your decision.",
        ],
      },
      {
        title: "3. Who may use it",
        body: [
          "Betmatic is for adults only: 18 or older, or older where your local law requires. By creating an account you confirm you meet that age. If we learn an account belongs to a minor, we close it.",
          "One account per person, for personal use, not transferable. Don't create extra accounts to stretch the free plan or the referral programme.",
        ],
      },
      {
        title: "4. Your account",
        body: [
          "Keep your password private. Under My account you can change it and sign out of every device. If you suspect someone else got in, do both and contact us.",
          "We may suspend or close accounts used for fraud, limit abuse, automation, reselling the content or breaching these terms. Where we can, we warn you first and explain why.",
        ],
      },
      {
        title: "5. Free plan, paid plans and coins",
        body: [
          {
            list: [
              "Free plan: one game a day (your pick), in the value band. A ticket you generate yourself shows at once; ready-made ones show after a 2-hour delay.",
              "Paid plans (Starter, Pro and Max) are prepaid for 1, 3, 6 or 12 months, at the prices and discounts on the plans page, charged in Brazilian reais (BRL) through Mercado Pago. It is a one-time payment and it never renews by itself.",
              "Your period starts when Mercado Pago confirms the payment. Buying the same plan again adds the new period to the time left. Switching plans mid-period converts the time left on the old plan into days on the new one, in proportion to their monthly prices.",
              "Tickets are built when an entitled user opens a game, within daily generation limits. If a generation fails, nothing is charged and you can try again.",
              "Coins pay for work done just for you (today: the analysis of a slip you built, 8 coins). If an analysis fails, the coins come back. Coins have no cash value, can't be transferred and are refundable only as the Refund policy says. They don't expire while your account exists.",
            ],
          },
          "Prices may change for future purchases; what you already paid for doesn't change.",
        ],
      },
      {
        title: "6. Withdrawal and refunds",
        body: ["You can cancel any purchase within 7 days for a full refund (Brazilian Consumer Code, art. 49). Details are in the [Refund policy](/refunds)."],
      },
      {
        title: "7. Referral programme",
        body: [
          "People who sign up through your link are tied to your account. When one of them makes a first paid purchase, you both get coins. Paid referrals are capped per person per day. Fake referrals, bulk accounts or self-referrals earn nothing, and coins obtained that way may be removed.",
        ],
      },
      {
        title: "8. Responsible gambling",
        body: [
          "We offer daily and weekly stake ceilings, a time reminder, a losing-streak notice and a 7- or 30-day pause that cannot be lifted early. See also [where to get help](/responsible-gambling).",
          "We don't use messages that promise profit, suggest chasing losses or present betting as a financial solution.",
        ],
      },
      {
        title: "9. Acceptable use",
        body: [
          "Not allowed: copying or reselling the content at scale, bots or scraping, getting around usage or payment limits, sharing an account, trying to reach other people's data, or any unlawful use.",
          "Betmatic's brand, software and texts are protected. Feel free to share links to tickets and to the public record.",
        ],
      },
      {
        title: "10. Liability",
        body: [
          "We work to keep the service up and the maths right, but it depends on third-party data and systems and can be interrupted. Because Betmatic takes no bets and betting decisions are yours, we are not liable for wins or losses on bets placed on the basis of the content. Nothing here limits the rights consumer law gives you.",
          "If a failure on our side keeps you from using a paid plan for more than 72 hours in a row, we extend your period by the time lost or refund the proportional amount, your choice.",
        ],
      },
      {
        title: "11. Closing your account",
        body: [
          "You can delete your account at any time under My account. Deletion erases your data except payment records, which we keep anonymised for as long as the law requires. An unused paid plan is refundable only as the Refund policy says.",
        ],
      },
      {
        title: "12. Changes",
        body: ["We may update these terms. Material changes are announced in the app in advance and, where the law requires, we ask you to accept them again. The last-updated date is at the top of the page."],
      },
      {
        title: "13. Governing law",
        body: ["These terms are governed by Brazilian law, including the Consumer Protection Code, the Internet Civil Framework and the LGPD. Disputes are heard in the courts of your place of residence."],
      },
    ],
  };
}
