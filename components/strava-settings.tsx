"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const STATUS: Record<string, string> = {
  ok: "Strava terhubung. Aktivitas 7 hari terakhir sudah ditarik.",
  denied: "Izin Strava dibatalkan.",
  bad_state: "Sesi login Strava kedaluwarsa / tidak cocok. Coba hubungkan lagi.",
  no_scope: "Izin \"lihat aktivitas\" tidak dicentang. Hubungkan lagi dan centang izin aktivitas (termasuk yang privat).",
  error: "Gagal menghubungkan Strava. Coba lagi.",
  not_configured: "Server belum punya STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET.",
};

export function StravaSettings({ configured, athlete, lastSync, status }: {
  configured: boolean; athlete: string | null; lastSync: string | null; status: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(status ? STATUS[status] ?? null : null);

  async function post(action: "sync" | "disconnect") {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/strava", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(d.error ?? "Gagal");
    setMsg(action === "sync"
      ? `${d.added} aktivitas baru masuk, ${d.skipped} dilewati (sudah tercatat / bukan lari)${d.errors?.length ? `, ${d.errors.length} gagal` : ""}.`
      : "Strava diputus.");
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
      <p className="font-medium">Strava</p>
      <p className="text-muted-foreground">
        Huawei Health → Strava → app ini. Lari baru masuk otomatis sebagai draft; kamu tinggal mengisi RPE & rasa.
      </p>
      {!configured ? (
        <p className="text-amber-700">Server belum dikonfigurasi untuk Strava — lihat README bagian Strava.</p>
      ) : athlete ? (
        <>
          <p>Terhubung sebagai <b>{athlete}</b>{lastSync ? ` · sinkron terakhir ${new Date(lastSync).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}` : ""}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => post("sync")}>Sinkron 14 hari</Button>
            <Button variant="outline" disabled={busy} onClick={() => post("disconnect")}>Putuskan</Button>
          </div>
        </>
      ) : (
        <a href="/api/strava/connect" className="self-start">
          {/* tombol resmi oranye Strava (#FC5200) sesuai panduan brand */}
          <span className="inline-flex h-11 items-center rounded-md bg-[#FC5200] px-4 font-semibold text-white">Connect with Strava</span>
        </a>
      )}
      {msg && <p className="text-muted-foreground">{msg}</p>}
      <p className="text-xs text-muted-foreground">Powered by Strava</p>
    </section>
  );
}
