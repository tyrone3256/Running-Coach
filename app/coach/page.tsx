import { CoachChat } from "@/components/coach-chat";
import { coachModel } from "@/lib/coach/server";

export const dynamic = "force-dynamic";

export default function CoachPage() {
  // hanya boolean & nama model yang dikirim ke client — key tetap di server
  return <CoachChat aiReady={!!process.env.ANTHROPIC_API_KEY} model={coachModel()} />;
}
