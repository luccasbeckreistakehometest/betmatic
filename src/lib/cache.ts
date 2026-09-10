import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const CACHE_DIR = path.join(process.cwd(), ".cache");

interface Envelope<T> {
  key: string;
  storedAt: number;
  value: T;
}

function fileFor(key: string) {
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 16);
  const safe = key.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60);
  return path.join(CACHE_DIR, `${safe}.${hash}.json`);
}

export function readCache<T>(key: string, ttlMs: number): T | null {
  if (ttlMs <= 0) return null;
  try {
    const raw = fs.readFileSync(fileFor(key), "utf8");
    const env = JSON.parse(raw) as Envelope<T>;
    if (Date.now() - env.storedAt > ttlMs) return null;
    return env.value;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const env: Envelope<T> = { key, storedAt: Date.now(), value };
    fs.writeFileSync(fileFor(key), JSON.stringify(env), "utf8");
  } catch {
    // Cache is best-effort; never fail a request because of it.
  }
}

export function cacheAge(key: string): number | null {
  try {
    const raw = fs.readFileSync(fileFor(key), "utf8");
    const env = JSON.parse(raw) as Envelope<unknown>;
    return Date.now() - env.storedAt;
  } catch {
    return null;
  }
}

/** Read-through cache. `force` skips the read but still writes the fresh value. */
export async function cached<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>,
  force = false,
): Promise<T> {
  if (!force) {
    const hit = readCache<T>(key, ttlMs);
    if (hit !== null) return hit;
  }
  const value = await producer();
  writeCache(key, value);
  return value;
}

/**
 * Read-through cache that refuses to store failures. Caching an error means a transient blip — or a
 * topped-up billing account — stays broken for the whole TTL.
 */
export async function cachedUnlessError<T extends { status: string }>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>,
  force = false,
): Promise<T> {
  if (!force) {
    const hit = readCache<T>(key, ttlMs);
    if (hit !== null) return hit;
  }
  const value = await producer();
  if (value.status !== "error") writeCache(key, value);
  return value;
}

export function clearCache(prefix?: string): number {
  let removed = 0;
  try {
    for (const file of fs.readdirSync(CACHE_DIR)) {
      if (prefix && !file.startsWith(prefix.replace(/[^a-zA-Z0-9._-]+/g, "_"))) continue;
      fs.unlinkSync(path.join(CACHE_DIR, file));
      removed += 1;
    }
  } catch {
    // no cache dir yet
  }
  return removed;
}
