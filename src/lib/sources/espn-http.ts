import fs from "node:fs";
import path from "node:path";

/**
 * One way to read ESPN's public JSON. ESPN_FIXTURES=<dir> turns it into a read-through replay for
 * tests: a URL whose fixture file exists is answered from disk, everything else still goes to the
 * network. Never set in production (lib/env.ts refuses it).
 */
// ESPN's payloads are deeply nested and undocumented; every access downstream is optional-chained.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

/** The fixture file name for a URL: host + path + query, flattened. */
export function fixtureKey(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 200);
}

function fixtureFor(url: string): Json | null {
  const dir = process.env.ESPN_FIXTURES;
  if (!dir) return null;
  const file = path.resolve(dir, `${fixtureKey(url)}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Json;
  } catch {
    return null;
  }
}

export class EspnHttpError extends Error {
  constructor(public status: number, url: string) {
    super(`ESPN ${status} for ${url}`);
    this.name = "EspnHttpError";
  }
}

export async function espnJson(url: string, opts: { timeoutMs?: number } = {}): Promise<Json> {
  const fixture = fixtureFor(url);
  if (fixture) {
    // A fixture can stand for a failing upstream: { "__status": 404 }.
    if (typeof fixture.__status === "number" && fixture.__status >= 400) throw new EspnHttpError(fixture.__status, url);
    return fixture;
  }
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "nba-bets-dashboard/1.0" },
    cache: "no-store",
    signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
  });
  if (!res.ok) throw new EspnHttpError(res.status, url);
  return (await res.json()) as Json;
}
