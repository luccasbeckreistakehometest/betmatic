import { NextResponse } from "next/server";
import { getGameDetail } from "@/lib/sources/espn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;
  const force = new URL(request.url).searchParams.get("force") === "1";
  try {
    const detail = await getGameDetail(gameId, force);
    if (!detail) return NextResponse.json({ error: "Game not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load game" },
      { status: 502 },
    );
  }
}
