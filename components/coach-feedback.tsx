"use client";
import { useEffect, useRef, useState } from "react";

/** Feedback coach per log: dibuat otomatis sekali saat log dibuka (bila AI aktif), lalu disimpan di log. */
export function CoachFeedback({ logId, initial, aiReady }: { logId: string; initial: string | null; aiReady: boolean }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(false);

  async function load(regenerate = false) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/coach/feedback", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ log_id: logId, regenerate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Gagal (${res.status})`);
      setText(data.text);
    } catch (e) {
      setErr(navigator.onLine ? (e as Error).message : "Offline — feedback dibuat saat online.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!initial && aiReady && !started.current) {
      started.current = true;
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!aiReady && !text) return null;
  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
      <div className="flex items-center justify-between">
        <p className="font-medium">Feedback coach</p>
        {text && !busy && aiReady && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => load(true)}>Buat ulang</button>
        )}
      </div>
      {busy && <p className="text-muted-foreground">Coach sedang membaca log…</p>}
      {text && !busy && <p className="whitespace-pre-line leading-relaxed">{text}</p>}
      {err && <p className="text-destructive">{err}</p>}
    </section>
  );
}
