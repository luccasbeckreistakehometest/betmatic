import { NextResponse } from "next/server";
import { gatherIntel, type SourceName } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Playwright captures plus AI extraction can legitimately run for minutes.
export const maxDuration = 300;

const VALID: SourceName[] = ["x", "propscash", "mamaknowsbets", "dimers", "brief", "bets"];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const sportKey = url.searchParams.get("sport") ?? undefined;
  const lang = url.searchParams.get("lang") ?? undefined;
  const bands = (url.searchParams.get("bands") ?? "").split(",").map((b) => b.trim()).filter(Boolean);
  const onlyParam = url.searchParams.get("only");
  const only = onlyParam
    ? (onlyParam.split(",").map((s) => s.trim()).filter((s): s is SourceName => VALID.includes(s as SourceName)))
    : undefined;

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
