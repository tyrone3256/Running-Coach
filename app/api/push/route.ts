import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPushStore, pushSubscriptionSchema } from "@/lib/push/store";

/** Daftarkan perangkat ini untuk notifikasi push. */
export async function POST(req: NextRequest) {
  const parsed = pushSubscriptionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Subscription tidak valid" }, { status: 422 });
  await getPushStore().add(parsed.data, req.headers.get("user-agent")?.slice(0, 200) ?? null);
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const parsed = z.object({ endpoint: z.string().url() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "endpoint wajib" }, { status: 422 });
  await getPushStore().remove(parsed.data.endpoint);
  return NextResponse.json({ ok: true });
}
