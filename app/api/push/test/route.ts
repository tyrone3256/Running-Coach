import { NextResponse } from "next/server";
import { pushConfigured, sendToAll } from "@/lib/push/send";

/** Kirim notifikasi uji ke semua perangkat terdaftar. */
export async function POST() {
  if (!pushConfigured()) return NextResponse.json({ error: "VAPID key belum diisi di server" }, { status: 503 });
  const r = await sendToAll({ title: "Tes notifikasi", body: "Notifikasi Coach Lari sudah aktif di perangkat ini.", url: "/settings", tag: "test" });
  return NextResponse.json(r);
}
