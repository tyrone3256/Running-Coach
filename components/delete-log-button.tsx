"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteLogButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  async function del() {
    setBusy(true);
    const res = await fetch(`/api/logs/${id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      router.push("/log");
      router.refresh();
    }
  }
  return confirm ? (
    <div className="flex items-center gap-3 text-sm">
      <span>Hapus log ini permanen?</span>
      <button type="button" onClick={del} disabled={busy} className="rounded-lg bg-destructive px-3 py-2 text-white">Hapus</button>
      <button type="button" onClick={() => setConfirm(false)} className="underline">Batal</button>
    </div>
  ) : (
    <button type="button" onClick={() => setConfirm(true)} className="self-start text-sm text-destructive underline">Hapus log</button>
  );
}
