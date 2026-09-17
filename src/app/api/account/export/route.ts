import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { exportAccount } from "@/lib/server/account-data";
import { apiError, rateLimited, requestLang } from "@/lib/server/api";
import { accountKey, hit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** LGPD art. 18: a copy of everything stored about the account, as a JSON download. */
export async function GET(request: Request) {
  const user = await currentUser();
  const lang = requestLang(request, user?.lang);
  if (!user) return apiError("unauthenticated", lang, 401);
  const limit = hit("exportAccount", accountKey(user.id));
  if (!limit.ok) return rateLimited(limit, lang);
  const data = exportAccount(user.id);
  if (!data) return apiError("not_found", lang, 404);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="betmatic-meus-dados-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
