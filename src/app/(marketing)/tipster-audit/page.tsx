import type { Metadata } from "next";
import { TipsterFunnel } from "@/components/TipsterFunnel";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    lang: "en",
    title: "Tipster audit: check the real record before you pay for a VIP group",
    description: "Paste a tipster's messages and see the real hit rate, game by game, against the official score — including wins posted after kickoff. Private: the name never shows.",
    paths: { pt: "/raio-x-tipster", en: "/tipster-audit" },
  });
}

export default function TipsterFunnelEn() {
  return <TipsterFunnel lang="en" />;
}
