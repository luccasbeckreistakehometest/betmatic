import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { SPORTS } from "@/lib/sports";
import {
  follow, issueLinkCode, linkStatus, listFollows, listNotifications, markNotificationsRead, setDigest, unfollow, unlinkTelegram, unreadCount,
} from "@/lib/server/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function state(userId: string) {
  return {
    telegram: linkStatus(userId),
    follows: listFollows(userId).map(({ userId: _u, ...f }) => { void _u; return f; }),
    notifications: listNotifications(userId),
    unread: unreadCount(userId),
    leagues: SPORTS.map((s) => ({ key: s.key, label: s.label, group: s.group })),
  };
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  return NextResponse.json(state(user.id));
}

const sportKey = z.string().refine((k) => SPORTS.some((s) => s.key === k), "esporte desconhecido");
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link_code") }),
  z.object({ action: z.literal("unlink") }),
  z.object({ action: z.literal("digest"), on: z.boolean() }),
  z.object({ action: z.literal("follow"), kind: z.enum(["team", "league"]), sportKey, key: z.string().max(40).default(""), label: z.string().max(80).default("") }),
  z.object({ action: z.literal("unfollow"), kind: z.enum(["team", "league"]), sportKey, key: z.string().max(40).default("") }),
  z.object({ action: z.literal("read"), ids: z.array(z.string()).nullable().default(null) }),
]);

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });
  const a = parsed.data;
  if (a.action === "link_code") issueLinkCode(user.id);
  else if (a.action === "unlink") unlinkTelegram(user.id);
  else if (a.action === "digest") setDigest(user.id, a.on);
  else if (a.action === "follow") { if (!follow(user.id, a)) return NextResponse.json({ error: "pedido inválido" }, { status: 400 }); }
  else if (a.action === "unfollow") unfollow(user.id, a.kind, a.sportKey, a.key);
  else if (a.action === "read") markNotificationsRead(user.id, a.ids);
  return NextResponse.json(state(user.id));
}
