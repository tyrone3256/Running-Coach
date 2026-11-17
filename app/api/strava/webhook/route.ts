import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { handleWebhookEvent } from "@/lib/strava/ingest";
import { ingestDeps, stravaConfigured } from "@/lib/strava/server";
import { runAsOwner, supabaseConfigured } from "@/lib/supabase/server";

export const maxDuration = 60;

const eq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Validasi saat membuat subscription webhook (Strava → GET dengan hub.challenge). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const verify = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (!verify || sp.get("hub.mode") !== "subscribe" || !eq(sp.get("hub.verify_token") ?? "", verify)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({ "hub.challenge": sp.get("hub.challenge") ?? "" });
}

const eventSchema = z.object({
  object_type: z.enum(["activity", "athlete"]),
  object_id: z.number().int(),
  aspect_type: z.enum(["create", "update", "delete"]),
  owner_id: z.number().int(),
  subscription_id: z.number().int(),
  event_time: z.number().int(),
  updates: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Event Strava. Webhook tidak ditandatangani, jadi kita (1) cocokkan subscription_id & athlete pemilik,
 * dan (2) tidak pernah memakai isi event selain id — data selalu diambil ulang dari API dengan token kita.
 * Strava minta balasan 200 dalam 2 detik → proses berjalan setelah respons (after()).
 */
export async function POST(req: NextRequest) {
  const parsed = eventSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !stravaConfigured()) return NextResponse.json({ ok: true }); // jangan bikin Strava retry
  const sub = process.env.STRAVA_SUBSCRIPTION_ID ? Number(process.env.STRAVA_SUBSCRIPTION_ID) : null;
  const evt = { ...parsed.data, updates: parsed.data.updates as Record<string, string> | undefined };
  after(async () => {
    try {
      const run = () => handleWebhookEvent(ingestDeps(), evt, sub);
      const msg = supabaseConfigured() ? await runAsOwner(run) : await run();
      console.log("strava webhook", evt.aspect_type, evt.object_id, msg);
    } catch (e) {
      console.error("strava webhook gagal", evt.object_id, e);
    }
  });
  return NextResponse.json({ ok: true });
}
