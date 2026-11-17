"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RED_FLAGS } from "@/lib/log/constants";
import { Button } from "@/components/ui/button";

/** Lapor gejala bahaya kapan saja (tidak harus lewat log) → STOP + program ditahan. */
export function ReportSymptoms() {
  const router = useRouter();
  const [flags, setFlags] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    const res = await fetch("/api/safety", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ flags }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(d.error ?? "Gagal");
    setMsg(d.message);
    router.refresh();
  }

  if (msg && flags.length) {
    return <p role="alert" className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">{msg}</p>;
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      {RED_FLAGS.map((f) => (
        <label key={f.id} className="flex items-center gap-2">
          <input type="checkbox" className="size-4" checked={flags.includes(f.id)}
            onChange={(e) => setFlags((xs) => (e.target.checked ? [...xs, f.id] : xs.filter((x) => x !== f.id)))} />
          {f.label}
        </label>
      ))}
      <Button variant="destructive" className="self-start" disabled={!flags.length || busy} onClick={send}>Laporkan gejala</Button>
      {msg && <p className="text-destructive">{msg}</p>}
    </div>
  );
}
