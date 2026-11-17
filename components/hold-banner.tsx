"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { STOP_MESSAGE } from "@/lib/log/safety";

export function HoldBanner({ reasons, since }: { reasons: string[]; since: string | null }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState("");
  async function clear() {
    await fetch("/api/hold", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note }) });
    router.refresh();
  }
  return (
    <section role="alert" className="flex flex-col gap-2 rounded-xl border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
      <p className="text-lg font-semibold">STOP — program ditahan</p>
      <p>{STOP_MESSAGE}</p>
      <p className="text-xs">Tercatat{since ? ` sejak ${since}` : ""}: {reasons.join(", ")}</p>
      {confirm ? (
        <div className="flex flex-col gap-2 text-foreground">
          <input className="h-10 rounded-lg border bg-background px-3" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan hasil pemeriksaan (opsional)" />
          <div className="flex gap-3">
            <button type="button" onClick={clear} className="rounded-lg bg-destructive px-3 py-2 text-white">Saya sudah diperiksa dokter</button>
            <button type="button" onClick={() => setConfirm(false)} className="underline">Batal</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="self-start text-xs underline">Sudah diperiksa dokter?</button>
      )}
    </section>
  );
}
