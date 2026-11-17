import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { RED_FLAGS } from "@/lib/log/constants";
import { STOP_MESSAGE } from "@/lib/log/safety";
import { recordSafetyEvent } from "@/lib/data/engine-service";

const ids = RED_FLAGS.map((f) => f.id) as [string, ...string[]];

/** Lapor gejala red flag di luar log → program ditahan sampai dinyatakan sudah diperiksa dokter. */
export async function POST(req: NextRequest) {
  const parsed = z.object({ flags: z.array(z.enum(ids)).min(1) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pilih minimal satu gejala" }, { status: 422 });
  const reasons = parsed.data.flags.map((id) => RED_FLAGS.find((f) => f.id === id)!.label);
  await recordSafetyEvent(reasons);
  return NextResponse.json({ message: STOP_MESSAGE, reasons });
}
