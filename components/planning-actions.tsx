"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { RaceDistance } from "@/lib/engine/types";
import { parseRaceTimeFor } from "@/lib/plan/time";

async function propose(body: object) {
  const res = await fetch("/api/planning", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  return res.ok ? { ok: true as const } : { ok: false as const, error: d.error ?? "Gagal" };
}

/** Tombol pembuat usulan (kalibrasi / program baru). Hasilnya menunggu persetujuan di bawah. */
export function ProposeButton({ kind, label, variant = "default" }: { kind: "recalibrate" | "program"; label: string; variant?: "default" | "outline" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button variant={variant} className="self-start" disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        const r = await propose({ kind });
        setBusy(false);
        if (!r.ok) setErr(r.error); else router.refresh();
      }}>{busy ? "Menyusun…" : label}</Button>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

export function GoalChange({ distance, current }: { distance: RaceDistance; current: string }) {
  const router = useRouter();
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="flex flex-col gap-2" onSubmit={async (e) => {
      e.preventDefault();
      const s = parseRaceTimeFor(distance, v);
      if (s == null) return setErr("Format waktu belum benar.");
      setBusy(true); setErr(null);
      const r = await propose({ kind: "goal", goal_time_s: s });
      setBusy(false);
      if (!r.ok) setErr(r.error); else { setV(""); router.refresh(); }
    }}>
      <div className="flex gap-2">
        <input aria-label="Target baru" className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base tabular-nums"
          value={v} onChange={(e) => setV(e.target.value)} placeholder={`target baru (sekarang ${current})`} />
        <Button type="submit" variant="outline" className="h-11" disabled={busy || !v.trim()}>Ubah target</Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </form>
  );
}
