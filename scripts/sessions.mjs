#!/usr/bin/env node
/** Shows which site sessions are saved and how old they are. */
import fs from "node:fs";
import path from "node:path";

// Dimers is open — it needs no session, so it is listed for completeness only.
const sites = ["x", "propscash", "mamaknowsbets"];
// Whichever provider AI_PROVIDER selects is the one whose key has to be there.
const openai = (process.env.AI_PROVIDER ?? "").trim().toLowerCase() === "openai";
const keyName = openai ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
const aiKey = Boolean(openai ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

console.log("\nSaved browser sessions\n");
for (const site of sites) {
  const file = path.join(process.cwd(), ".sessions", `${site}.json`);
  if (!fs.existsSync(file)) {
    console.log(`  ${site.padEnd(16)} missing        → pnpm login ${site}`);
    continue;
  }
  const stat = fs.statSync(file);
  const days = (Date.now() - stat.mtimeMs) / 86_400_000;
  const cookies = JSON.parse(fs.readFileSync(file, "utf8")).cookies?.length ?? 0;
  const age = days < 1 ? `${Math.round(days * 24)}h old` : `${days.toFixed(1)}d old`;
  console.log(`  ${site.padEnd(16)} ${String(cookies).padStart(3)} cookies, ${age.padEnd(10)} ${days > 14 ? "→ probably stale, re-run pnpm login" : ""}`);
}
console.log(`\n${keyName.padEnd(17)}  ${aiKey ? "set" : "NOT SET — AI extraction is disabled"}\n`);
