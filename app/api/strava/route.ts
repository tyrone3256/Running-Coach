import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { revoke } from "@/lib/strava/api";
import { syncRecent } from "@/lib/strava/ingest";
import { ingestDeps, stravaConfigured, stravaCreds } from "@/lib/strava/server";
import { getStravaStore } from "@/lib/strava/store";

const body = z.object({
  action: z.enum(["sync", "disconnect", "dismiss", "restore"]),
  activity_id: z.number().int().optional(),
  days: z.number().int().min(1).max(60).optional(),
});

/** Aksi Strava dari UI: sinkron sekarang, putuskan, abaikan/kembalikan item inbox. */
export async function POST(req: NextRequest) {
  if (!stravaConfigured()) return NextResponse.json({ error: "Strava belum dikonfigurasi di server" }, { status: 503 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Aksi tidak valid" }, { status: 422 });
  const store = getStravaStore();
  const { action, activity_id, days } = parsed.data;
  try {
    switch (action) {
      case "sync":
        return NextResponse.json(await syncRecent(ingestDeps(), days ?? 14));
      case "disconnect": {
        const c = await store.getConnection();
        if (c) {
          await revoke(fetch, stravaCreds(), c.refresh_token); // gagal cabut di Strava tetap hapus token lokal
          await store.deleteConnection();
        }
        return NextResponse.json({ ok: true });
      }
      case "dismiss":
      case "restore":
        if (!activity_id) return NextResponse.json({ error: "activity_id wajib" }, { status: 422 });
        await store.setInboxStatus(activity_id, action === "dismiss" ? "dismissed" : "pending");
        return NextResponse.json({ ok: true });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
