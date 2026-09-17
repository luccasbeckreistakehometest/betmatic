import type { Metadata } from "next";
import { TipsterFunnel } from "@/components/TipsterFunnel";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    lang: "pt",
    title: "Raio-x do tipster: confira o acerto real antes de pagar grupo VIP",
    description: "Cole as mensagens do tipster e veja o acerto real, jogo a jogo, contra o placar oficial — inclusive os greens postados depois do jogo começar. Privado: o nome nunca aparece.",
    paths: { pt: "/raio-x-tipster", en: "/tipster-audit" },
  });
}

export default function TipsterFunnelPt() {
  return <TipsterFunnel lang="pt" />;
}
