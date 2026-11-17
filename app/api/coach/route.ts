import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { chatHistorySchema, runCoach } from "@/lib/coach/agent";
import { coachOptions } from "@/lib/coach/server";

export const maxDuration = 300;

const body = z.object({ messages: chatHistorySchema });

export async function POST(req: NextRequest) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pesan tidak valid" }, { status: 422 });
  try {
    const reply = await runCoach(parsed.data.messages, coachOptions());
    return NextResponse.json(reply);
  } catch (e) {
    console.error("coach error", e);
    return NextResponse.json({ error: "Coach gagal menjawab. Coba lagi sebentar." }, { status: 502 });
  }
}
