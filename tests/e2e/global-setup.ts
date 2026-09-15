import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Fresh database, then the real seed script writes the slate the specs read.
export default async function globalSetup() {
  const dir = path.join(process.cwd(), "data", "e2e");
  fs.rmSync(dir, { recursive: true, force: true });
  const r = spawnSync("npx", ["tsx", "scripts/seed-sev-val.mts"], { env: { ...process.env, DATA_DIR: "data/e2e", ADMIN_EMAIL: "admin@betmatic.app", ADMIN_PASSWORD: "betmatic2026" }, stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0) throw new Error(`seed failed: ${r.stderr}`);
}
