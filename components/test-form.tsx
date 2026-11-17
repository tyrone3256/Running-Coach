"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { parseDuration, parseKm } from "@/lib/log/units";

const inputCls = "h-11 w-full rounded-lg border bg-background px-3 text-base tabular-nums";

export function TestForm({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const [type, setType] = useState<"30min" | "10k_tt">("30min");
  const [date, setDate] = useState(defaultDate);
  const [km, setKm] = useState("");
  const [dur, setDur] = useState("30:00");
  const [hr, setHr] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const distance_m = type === "10k_tt" ? 10000 : parseKm(km);
    const duration_s = type === "30min" ? 1800 : parseDuration(dur);
    if (!distance_m || !duration_s) return setErr("Isi jarak (tes 30′) atau waktu (10K).");
    const avg = hr.trim() ? Math.round(Number(hr)) : null;
    setBusy(true);
    const res = await fetch("/api/tests", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, distance_m, duration_s, avg_hr_last20: avg, date }),
    });
    setBusy(false);
    if (!res.ok) return setErr((await res.json().catch(() => ({}))).error ?? "Gagal");
    router.push("/program/changes");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 text-sm">
      <div className="grid grid-cols-2 gap-2">
        {(["30min", "10k_tt"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setType(t)} aria-pressed={type === t}
            className={`h-11 rounded-lg border ${type === t ? "border-primary bg-primary text-primary-foreground" : ""}`}>
            {t === "30min" ? "Tes 30 menit (W05)" : "10K time trial (W14)"}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Tanggal</span>
        <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {type === "30min" ? (
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Jarak dalam 30 menit (km)</span>
          <input inputMode="decimal" className={inputCls} value={km} onChange={(e) => setKm(e.target.value)} placeholder="6,2" />
        </label>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Waktu 10K</span>
          <input inputMode="numeric" className={inputCls} value={dur} onChange={(e) => setDur(e.target.value)} placeholder="47:30" />
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Avg HR 20 menit terakhir (untuk LTHR){type === "10k_tt" ? " — opsional" : ""}</span>
        <input inputMode="numeric" className={inputCls} value={hr} onChange={(e) => setHr(e.target.value)} placeholder="171" />
        <span className="text-xs text-muted-foreground">Pakai chest strap bila ada — HR jam tangan sering meleset di intensitas tinggi.</span>
      </label>
      {err && <p className="text-destructive">{err}</p>}
      <Button type="submit" className="h-12" disabled={busy}>{busy ? "Menghitung…" : "Hitung & tampilkan sebelum/sesudah"}</Button>
      <p className="text-xs text-muted-foreground">Hasilnya berupa usulan yang harus kamu setujui — program tidak berubah sebelum itu.</p>
    </form>
  );
}
