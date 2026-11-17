import { NextResponse, type NextRequest } from "next/server";
import { workoutLogSchema } from "@/lib/log/schema";
import { getStore } from "@/lib/data/store";
import { STOP_MESSAGE } from "@/lib/log/safety";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body bukan JSON" }, { status: 400 });
  }
  const parsed = workoutLogSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Data log tidak valid", issues: parsed.error.issues }, { status: 422 });
  }
  try {
    const { log, duplicate } = await getStore().saveLog(parsed.data);
    return NextResponse.json({
      id: log.id,
      duplicate,
      safety: log.safety,
      message: log.safety.level === "stop" ? STOP_MESSAGE : null,
    }, { status: duplicate ? 200 : 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
