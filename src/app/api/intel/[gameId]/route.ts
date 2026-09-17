import { NextResponse } from "next/server";
import { gatherIntel, type SourceName } from "@/lib/intel";
import { listExtraSources, loadConfig } from "@/lib/config";
import { requireAdmin } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Playwright captures plus AI extraction can legitimately run for minutes.
export const maxDuration = 300;

const BUILTIN: SourceName[] = ["x", "propscash", "mamaknowsbets", "dimers", "brief", "bets"];

/** Extra sources are configured, not compiled in, so the valid set has to be read at request time. */
function validSources(): Set<string> {
  return new Set([...BUILTIN, ...listExtraSources(loadConfig()).map((e) => e.key)]);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  // Scrapes with a real browser and calls the model without the on-demand caps: admin research only.
  if (!(await requireAdmin())) return Response.json({ error: "forbidden" }, { status: 403 });
  const { gameId } = await params;
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const sportKey = url.searchParams.get("sport") ?? undefined;
  const lang = url.searchParams.get("lang") ?? undefined;
  const bands = (url.searchParams.get("bands") ?? "").split(",").map((b) => b.trim()).filter(Boolean);
  const onlyParam = url.searchParams.get("only");
  const valid = validSources();
  const requested = onlyParam ? onlyParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const unknownSources = requested.filter((s) => !valid.has(s));
  const only = requested.filter((s) => valid.has(s));

  // An unrecognised name must fail loudly; silently falling back to "gather everything" is the
  // opposite of what the caller asked for, and costs a full round of extractions.
  if (unknownSources.length) {
    return NextResponse.json(
      { error: `Unknown source(s): ${unknownSources.join(", ")}. Valid: ${[...valid].join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const intel = await gatherIntel(gameId, { force, only: only?.length ? only : undefined, sportKey, lang: lang as never, bands: bands.length ? bands : undefined });
    return NextResponse.json(intel);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to gather intel" },
      { status: 502 },
    );
  }
}
