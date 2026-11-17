import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { approveChange, rejectChange, revertChange } from "@/lib/data/engine-service";

const body = z.object({ action: z.enum(["approve", "reject", "revert"]), alternative: z.string().max(40).nullable().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Aksi tidak valid" }, { status: 422 });
  try {
    const { action, alternative } = parsed.data;
    if (action === "reject") {
      await rejectChange(id);
      return NextResponse.json({ ok: true });
    }
    const r = action === "approve" ? await approveChange(id, alternative ?? null) : await revertChange(id);
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
