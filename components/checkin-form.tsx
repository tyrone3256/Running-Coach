"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/offline/queue";
import type { CheckinInput } from "@/lib/log/schema";

const inputCls = "h-11 w-full rounded-lg border bg-background px-3 text-base tabular-nums";

export function CheckinForm({ date, initial }: { date: string; initial: CheckinInput | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(!initial);
  const [rhr, setRhr] = useState(initial?.resting_hr?.toString() ?? "");
  const [sleep, setSleep] = useState(initial?.sleep_h?.toString() ?? "");
  const [sore, setSore] = useState(initial?.soreness ?? 3);
  const [pain, setPain] = useState(initial?.pain_score ?? 0);
  const [painLoc, setPainLoc] = useState(initial?.pain_location ?? "");
  const [hrv, setHrv] = useState(initial?.hrv?.toString() ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open && initial) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-xl border bg-card px-4 py-3 text-left text-sm">
        <span className="text-muted-foreground">Check-in pagi ✓</span>
        <span className="tabular-nums">
          RHR {initial.resting_hr ?? "–"} · tidur {initial.sleep_h ?? "–"} j · pegal {initial.soreness ?? "–"}
          {initial.pain_score ? ` · nyeri ${initial.pain_score}` : ""}
        </span>
      </button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
    const body: CheckinInput = {
      date,
      resting_hr: n(rhr) == null ? null : Math.round(n(rhr)!),
      sleep_h: n(sleep),
      soreness: sore,
      pain_score: pain,
      pain_location: pain > 0 && painLoc.trim() ? painLoc.trim() : null,
      hrv: n(hrv),
    };
    setBusy(true);
    const r = await postJson<{ error?: string }>("/api/checkins", body);
    setBusy(false);
    if (r.status === "queued") return setMsg("Tersimpan di HP, dikirim saat online.");
    if (!r.ok) return setMsg(r.data?.error ?? "Gagal menyimpan");
    setOpen(false);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <p className="font-medium">Check-in pagi</p>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">HR istirahat</span>
          <input inputMode="numeric" className={inputCls} value={rhr} onChange={(e) => setRhr(e.target.value)} placeholder="52" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Tidur (jam)</span>
          <input inputMode="decimal" className={inputCls} value={sleep} onChange={(e) => setSleep(e.target.value)} placeholder="7" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">HRV (ops.)</span>
          <input inputMode="numeric" className={inputCls} value={hrv} onChange={(e) => setHrv(e.target.value)} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Pegal: <b className="text-foreground">{sore}</b>/10</span>
        <input type="range" min={1} max={10} value={sore} onChange={(e) => setSore(Number(e.target.value))} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Nyeri: <b className="text-foreground">{pain}</b>/10</span>
        <input type="range" min={0} max={10} value={pain} onChange={(e) => setPain(Number(e.target.value))} />
      </label>
      {pain > 0 && (
        <input className={inputCls} value={painLoc} onChange={(e) => setPainLoc(e.target.value)} placeholder="Lokasi nyeri" />
      )}
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      <Button type="submit" className="h-11" disabled={busy}>{busy ? "Menyimpan…" : "Simpan check-in"}</Button>
    </form>
  );
}
