import { NextResponse, type NextRequest } from "next/server";
import { checkinSchema } from "@/lib/log/schema";
import { getStore } from "@/lib/data/store";

export async function POST(req: NextRequest) {
  const parsed = checkinSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check-in tidak valid", issues: parsed.error.issues }, { status: 422 });
  }
  try {
    const row = await getStore().saveCheckin(parsed.data);
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
