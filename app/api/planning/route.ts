import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { planningProfileSchema } from "@/lib/plan/profile";
import { planningView, proposeGoal, proposeNextProgram, proposeRecalibration, savePlanning } from "@/lib/data/planning-service";

/** Simpan profil perencanaan (tab Target) → kembalikan analisis terbaru. */
export async function POST(req: NextRequest) {
  const parsed = planningProfileSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Data belum lengkap/benar", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 422 });
  }
  await savePlanning(parsed.data);
  return NextResponse.json(await planningView());
}

const proposeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("goal"), goal_time_s: z.number().int().min(12 * 60).max(8 * 3600) }),
  z.object({ kind: z.literal("recalibrate") }),
  z.object({ kind: z.literal("program") }),
]);

/** Buat usulan perubahan besar (selalu menunggu persetujuan). */
export async function PUT(req: NextRequest) {
  const parsed = proposeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Permintaan tidak valid" }, { status: 422 });
  try {
    const b = parsed.data;
    if (b.kind === "goal") return NextResponse.json({ record: await proposeGoal(b.goal_time_s) });
    if (b.kind === "recalibrate") return NextResponse.json({ record: await proposeRecalibration() });
    return NextResponse.json(await proposeNextProgram());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
