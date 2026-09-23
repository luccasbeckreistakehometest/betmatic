/**
 * The Brasília calendar day of an instant, the way the app counts a "day" everywhere else. It lives
 * on its own so the ledger's readers can share it without importing each other: the balance needs
 * the calibration and the calibration needs the day.
 */
export function brasiliaDay(iso: string | undefined, fallback = ""): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return fallback;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
