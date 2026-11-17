import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { loadState, processTrigger } from "@/lib/data/engine-service";
import { eveningMessage, morningMessage } from "@/lib/push/messages";
import { pushConfigured, sendToAll } from "@/lib/push/send";
import { runAsOwner, supabaseConfigured } from "@/lib/supabase/server";
import { ingestDeps, stravaConfigured } from "@/lib/strava/server";
import { getStravaStore } from "@/lib/strava/store";
import { syncRecent } from "@/lib/strava/ingest";

export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // lokal: boleh tanpa secret
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Dipanggil Vercel Cron (GET + Authorization: Bearer CRON_SECRET). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { job } = await params;
  if (job !== "morning" && job !== "evening") return NextResponse.json({ error: "job tidak dikenal" }, { status: 404 });

  const work = async () => {
    // cadangan webhook: tarik aktivitas Strava 2 hari terakhir (draft masuk inbox, tidak jadi log otomatis)
    const strava = stravaConfigured() && (await getStravaStore().getConnection())
      ? await syncRecent(ingestDeps(), 2).catch((e) => ({ error: (e as Error).message }))
      : null;
    // pagi: jalankan engine harian dulu (sesi terlewat, ACWR) supaya notifikasi memakai plan terbaru
    const engine = job === "morning" ? await processTrigger({ kind: "daily" }) : null;
    const state = await loadState();
    const msg = job === "morning" ? morningMessage(state) : eveningMessage(state);
    const push = msg && pushConfigured() ? await sendToAll(msg) : null;
    return {
      job, today: state.today, message: msg, strava,
      engine: engine && { applied: engine.applied.length, pending: engine.pending.length, blocked: engine.blocked.length },
      push: push ?? (msg ? "push belum dikonfigurasi" : "tidak ada notifikasi"),
    };
  };
  try {
    return NextResponse.json(supabaseConfigured() ? await runAsOwner(work) : await work());
  } catch (e) {
    console.error("cron gagal", job, e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
