/**
 * Company identity and support channels. Everything comes from env; nothing is invented. When a
 * value is unset the pages leave the line out and point to the in-app contact form.
 */
const env = process.env;
const read = (key: string): string | null => {
  const v = (env[key] ?? "").trim();
  return v && !v.startsWith("#") ? v : null;
};

export interface LegalIdentity {
  name: string | null;
  document: string | null;
  address: string | null;
  email: string | null;
}

export function legalIdentity(): LegalIdentity {
  return { name: read("LEGAL_NAME"), document: read("LEGAL_DOCUMENT"), address: read("LEGAL_ADDRESS"), email: read("LEGAL_EMAIL") };
}

export interface SupportChannels {
  email: string | null;
  /** Digits only, with country code, for a wa.me link. */
  whatsapp: string | null;
}

export function supportChannels(): SupportChannels {
  const wa = (read("SUPPORT_WHATSAPP") ?? "").replace(/\D/g, "");
  return { email: read("SUPPORT_EMAIL"), whatsapp: wa.length >= 10 ? wa : null };
}
