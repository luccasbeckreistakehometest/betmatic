import { NextResponse } from "next/server";
import { sessionSummary } from "@/lib/browser/session";
import { aiConfigured, MODEL } from "@/lib/ai/client";
import { listExtraSources, loadConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = loadConfig();
  const saved = sessionSummary();
  // Sources that need no login should not read as "session missing" in the header.
  const sessions = {
    x: { ...saved.x, requiresLogin: true, label: "X" },
    propscash: { ...saved.propscash, requiresLogin: cfg.propscash.requiresLogin, label: cfg.propscash.label },
    mamaknowsbets: { ...saved.mamaknowsbets, requiresLogin: cfg.mamaknowsbets.requiresLogin, label: cfg.mamaknowsbets.label },
    dimers: { ...saved.dimers, requiresLogin: cfg.dimers.requiresLogin, label: cfg.dimers.label },
    ...Object.fromEntries(
      listExtraSources(cfg).map((e) => [
        e.key,
        { present: false, ageMs: null, requiresLogin: e.config.requiresLogin, label: e.config.label },
      ]),
    ),
  };
  return NextResponse.json({
    sessions,
    ai: { configured: aiConfigured(), model: MODEL },
    sources: {
      x: { enabled: cfg.x.enabled, accounts: cfg.x.insiders.length, lookbackHours: cfg.x.lookbackHours },
      propscash: { enabled: cfg.propscash.enabled, label: cfg.propscash.label, targetUrl: cfg.propscash.targetUrl },
      mamaknowsbets: { enabled: cfg.mamaknowsbets.enabled, label: cfg.mamaknowsbets.label, targetUrl: cfg.mamaknowsbets.targetUrl },
      dimers: { enabled: cfg.dimers.enabled, label: cfg.dimers.label, targetUrl: cfg.dimers.targetUrl, requiresLogin: cfg.dimers.requiresLogin },
    },
  });
}
