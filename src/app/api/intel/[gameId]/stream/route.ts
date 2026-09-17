import { streamIntel, type SourceName } from "@/lib/intel";
import { listExtraSources, loadConfig } from "@/lib/config";
import { requireAdmin } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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

  if (unknownSources.length) {
    return new Response(
      JSON.stringify({ type: "error", message: `Unknown source(s): ${unknownSources.join(", ")}. Valid: ${[...valid].join(", ")}` }) + "\n",
      { status: 400, headers: { "content-type": "application/x-ndjson" } },
    );
  }

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
