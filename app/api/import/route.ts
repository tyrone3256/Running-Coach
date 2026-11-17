import { NextResponse, type NextRequest } from "next/server";
import { parseActivityFile, ParseError } from "@/lib/log/parse";
import { buildDraft } from "@/lib/log/draft";
import { getPlan } from "@/lib/data/plan";

export const runtime = "nodejs";
const MAX_BYTES = 20 * 1024 * 1024;

/** Upload FIT/GPX/TCX → draft log (TIDAK disimpan; user konfirmasi lewat /api/logs). */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "File tidak ada" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File > 20 MB" }, { status: 413 });
  const hrSource = form?.get("hr_source") === "chest" ? "chest" : "wrist";
  try {
    const act = parseActivityFile(file.name, new Uint8Array(await file.arrayBuffer()));
    const plan = await getPlan();
    const draft = buildDraft(act, {
      lthr: plan.hrProfile.lthr, profile: plan.paceProfile, sessions: plan.sessions,
      fileName: file.name, hrSource,
    });
    return NextResponse.json(draft);
  } catch (e) {
    const msg = e instanceof ParseError ? e.message : `Gagal membaca file: ${(e as Error).message}`;
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
