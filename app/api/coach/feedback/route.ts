import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { runCoach } from "@/lib/coach/agent";
import { coachOptions } from "@/lib/coach/server";
import { FEEDBACK_PROMPT } from "@/lib/coach/prompt";
import { getStore } from "@/lib/data/store";
import { STOP_MESSAGE } from "@/lib/log/safety";

export const maxDuration = 300;

const READ_ONLY = ["get_athlete_profile", "get_plan", "get_logs", "get_metrics", "get_readiness", "get_z4_tolerance", "explain_session"];

/** Feedback coach untuk satu log; disimpan di log supaya tidak dibuat ulang. */
export async function POST(req: NextRequest) {
  const parsed = z.object({ log_id: z.string().min(1), regenerate: z.boolean().optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "log_id wajib" }, { status: 422 });
  const store = getStore();
  const log = await store.getLog(parsed.data.log_id);
  if (!log) return NextResponse.json({ error: "Log tidak ditemukan" }, { status: 404 });
  if (log.coach_feedback && !parsed.data.regenerate) return NextResponse.json({ text: log.coach_feedback, cached: true });
  // Log red flag: tidak ada feedback latihan (deterministik, tanpa LLM)
  if (log.safety.level === "stop") return NextResponse.json({ text: STOP_MESSAGE, safetyStop: true });
  const opt = coachOptions({ allowedTools: READ_ONLY, maxIterations: 6 });
  if (!opt.createMessage) return NextResponse.json({ error: "Coach AI belum aktif (ANTHROPIC_API_KEY kosong)." }, { status: 503 });
  try {
    const reply = await runCoach([{ role: "user", content: FEEDBACK_PROMPT(log.id) }], opt);
    await store.annotateLog(log.id, { coach_feedback: reply.text, coach_feedback_at: new Date().toISOString() });
    return NextResponse.json({ text: reply.text, cached: false });
  } catch (e) {
    console.error("feedback error", e);
    return NextResponse.json({ error: "Coach gagal membuat feedback." }, { status: 502 });
  }
}
