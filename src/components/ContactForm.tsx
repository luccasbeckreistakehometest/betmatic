"use client";

import { useState } from "react";
import type { Lang } from "@/lib/i18n";

const TOPICS = {
  pt: { account: "Minha conta ou senha", payment: "Pagamento", refund: "Reembolso / arrependimento", privacy: "Meus dados (LGPD)", bug: "Algo não funciona", other: "Outro assunto" },
  en: { account: "My account or password", payment: "Payment", refund: "Refund / withdrawal", privacy: "My data (LGPD)", bug: "Something is broken", other: "Something else" },
} as const;

const C = {
  pt: { name: "Nome", email: "E-mail para resposta", topic: "Assunto", message: "Mensagem", send: "Enviar", sending: "Enviando…", sent: "Recebemos sua mensagem. Respondemos no e-mail informado em até 5 dias úteis.", hint: "Sobre pagamento, inclua o e-mail da conta e, se tiver, o número do pagamento. Nunca envie sua senha.", min: "Escreva pelo menos 10 caracteres.", failed: "Não deu para enviar agora. Tente de novo em instantes." },
  en: { name: "Name", email: "Email for our reply", topic: "Topic", message: "Message", send: "Send", sending: "Sending…", sent: "We got your message. We'll reply to that email within 5 business days.", hint: "For payments, include your account email and, if you have it, the payment number. Never send your password.", min: "Write at least 10 characters.", failed: "Couldn't send right now. Try again shortly." },
};

type Topic = keyof (typeof TOPICS)["pt"];

export function ContactForm({ lang, defaultName = "", defaultEmail = "", defaultTopic = "other" }: { lang: Lang; defaultName?: string; defaultEmail?: string; defaultTopic?: string }) {
  const c = C[lang];
  const [form, setForm] = useState({ name: defaultName, email: defaultEmail, topic: (defaultTopic in TOPICS.pt ? defaultTopic : "other") as Topic, message: "", website: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.message.trim().length < 10) { setError(c.min); return; }
    setState("sending");
    setError(null);
    try {
      const r = await fetch(`/api/contact?lang=${lang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, lang, website: form.website || undefined }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { setState("sent"); return; }
      setError(j.message ?? c.failed);
    } catch {
      setError(c.failed);
    }
    setState("idle");
  }

  if (state === "sent") return <p className="rounded-panel border border-pos bg-action px-4 py-3 text-base text-fg" role="status" data-testid="contact-sent">{c.sent}</p>;

  const field = "w-full rounded-control border border-line-strong bg-surface-1 px-3 py-2.5 text-base text-fg";
  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5" data-testid="contact-form">
      <div className="grid gap-3.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-tiny text-fg-muted">{c.name}
          <input className={field} value={form.name} maxLength={80} autoComplete="name" onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="contact-name" />
        </label>
        <label className="flex flex-col gap-1.5 text-tiny text-fg-muted">{c.email}
          <input className={field} type="email" required maxLength={254} autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="contact-email" />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-tiny text-fg-muted">{c.topic}
        <select className={field} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value as Topic })} data-testid="contact-topic">
          {(Object.keys(TOPICS[lang]) as Topic[]).map((k) => <option key={k} value={k}>{TOPICS[lang][k]}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-tiny text-fg-muted">{c.message}
        <textarea className={`${field} min-h-36`} required maxLength={4000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} data-testid="contact-message" />
      </label>
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Deixe em branco<input tabIndex={-1} type="text" autoComplete="new-password" data-lpignore="true" data-1p-ignore name="bm_hp_field" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></label>
      </div>
      <p className="text-tiny text-fg-dim">{c.hint}</p>
      {error && <p className="text-sm text-neg" role="alert" data-testid="contact-error">{error}</p>}
      <button type="submit" disabled={state === "sending"} className="w-fit inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap bg-action text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover active:bg-action-active disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-faint" data-testid="contact-submit">
        {state === "sending" ? c.sending : c.send}
      </button>
    </form>
  );
}
