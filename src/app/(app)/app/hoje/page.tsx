import { TodayBoard } from "@/components/TodayBoard";

export const dynamic = "force-dynamic";

/**
 * The day's short list. The board reads /api/today on the client, which is what lets the same
 * screen answer for whichever sport the shell's picker is on without a round trip through the URL.
 */
export default function TodayPage() {
  return <TodayBoard />;
}
