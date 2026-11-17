"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Status = "loading" | "unsupported" | "denied" | "off" | "on";

function b64ToUint8(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushSettings({ vapidKey }: { vapidKey: string | null }) {
  const [status, setStatus] = useState<Status>("loading");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setStatus("unsupported");
      if (Notification.permission === "denied") return setStatus("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setStatus(sub ? "on" : "off");
    })();
  }, []);

  async function enable() {
    if (!vapidKey) return;
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setStatus(perm === "denied" ? "denied" : "off"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(vapidKey) });
      const res = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Gagal menyimpan");
      setStatus("on");
      setMsg("Notifikasi aktif di perangkat ini.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setStatus("off");
    setBusy(false);
    setMsg("Notifikasi dimatikan di perangkat ini.");
  }

  async function test() {
    setBusy(true);
    const res = await fetch("/api/push/test", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? `Terkirim ke ${data.sent} perangkat.` : data.error ?? "Gagal");
  }

  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
      <p className="font-medium">Notifikasi</p>
      <p className="text-muted-foreground">
        05:00 WIB: sesi hari ini & pengingat check-in (hari tanpa lari: hanya bila ada perubahan yang perlu disetujui).
        19:00 WIB: pengingat log bila sesi hari ini belum dicatat.
      </p>
      {!vapidKey && <p className="text-amber-700">Server belum punya VAPID key — lihat README bagian Deploy.</p>}
      {status === "unsupported" && <p>Browser ini tidak mendukung push. Di Android pakai Chrome dan pasang app ke layar utama.</p>}
      {status === "denied" && <p>Izin notifikasi diblokir. Buka pengaturan situs di browser → Notifikasi → Izinkan.</p>}
      <div className="flex flex-wrap gap-2">
        {status === "off" && <Button onClick={enable} disabled={busy || !vapidKey}>Aktifkan notifikasi</Button>}
        {status === "on" && (
          <>
            <Button variant="outline" onClick={test} disabled={busy}>Kirim tes</Button>
            <Button variant="outline" onClick={disable} disabled={busy}>Matikan</Button>
          </>
        )}
      </div>
      {msg && <p className="text-muted-foreground">{msg}</p>}
    </section>
  );
}
