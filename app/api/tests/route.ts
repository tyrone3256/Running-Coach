import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { submitTest } from "@/lib/data/engine-service";

const schema = z.object({
  type: z.enum(["30min", "10k_tt"]),
  distance_m: z.number().min(3000).max(15000),
  duration_s: z.number().int().min(600).max(5400),
  avg_hr_last20: z.number().int().min(120).max(220).nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** R5: hasil tes/TT → usulan BESAR (LTHR & pace) yang harus disetujui. */
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data tes tidak valid", issues: parsed.error.issues }, { status: 422 });
  try {
    const rec = await submitTest(parsed.data);
    return NextResponse.json({ id: rec.id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
