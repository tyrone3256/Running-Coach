import { NextResponse, type NextRequest } from "next/server";
import { clearHold } from "@/lib/data/engine-service";

/** User menyatakan sudah diperiksa dokter → hold red flag dibuka (R10). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { note?: unknown };
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
  await clearHold(note);
  return NextResponse.json({ ok: true });
}
