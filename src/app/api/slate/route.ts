import { NextResponse } from "next/server";
import { getSlateOrNearest, todayKey } from "@/lib/sources/espn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? todayKey();
  const force = url.searchParams.get("force") === "1";
  try {
    const slate = await getSlateOrNearest(date, force);
    return NextResponse.json(slate);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load slate" },
      { status: 502 },
    );
  }
}
