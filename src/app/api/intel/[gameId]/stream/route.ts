import { streamIntel, type SourceName } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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
    ? onlyParam.split(",").map((s) => s.trim()).filter((s): s is SourceName => VALID.includes(s as SourceName))
    : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of streamIntel(gameId, { force, only: only?.length ? only : undefined, sportKey, lang: lang as never, bands: bands.length ? bands : undefined })) {
          send(event);
        }
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Gather failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
