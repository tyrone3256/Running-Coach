"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LogForm, type SessionOption } from "@/components/log-form";
import type { ImportDraft } from "@/lib/log/draft";

export function ImportForm({ sessions }: { sessions: SessionOption[] }) {
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hrSource, setHrSource] = useState<"wrist" | "chest">("wrist");

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) setErr(data.error ?? "Gagal membaca file");
      else setDraft(data as ImportDraft);
    } catch {
      setErr("Tidak ada koneksi. Import file butuh sinyal (log manual tetap bisa offline).");
    } finally {
      setBusy(false);
    }
  }

  if (draft) {
    return (
      <LogForm
        initial={draft.log}
        sessions={sessions}
        quick={false}
        importMeta={{ warnings: draft.warnings, device: draft.device, reps_detected: draft.reps_detected, reps_expected: draft.reps_expected }}
      />
    );
  }

  return (
    <form onSubmit={upload} className="flex flex-col gap-4">
      <label className="flex flex-col gap-2 rounded-xl border border-dashed p-6 text-center text-sm">
        <span className="font-medium">Pilih file .fit / .gpx / .tcx</span>
        <span className="text-xs text-muted-foreground">
          Dari Huawei Health: buka aktivitas di Strava (web) → ⋯ → Export Original / Export GPX.
        </span>
        <input name="file" type="file" accept=".fit,.gpx,.tcx,application/gpx+xml,application/octet-stream" required className="text-sm" />
      </label>
      <label className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Sensor HR</span>
        <select name="hr_source" value={hrSource} onChange={(e) => setHrSource(e.target.value as "wrist" | "chest")}
          className="h-10 rounded-lg border bg-background px-2">
          <option value="wrist">Jam (wrist)</option>
          <option value="chest">Chest strap</option>
        </select>
      </label>
      {err && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{err}</p>}
      <Button type="submit" className="h-12" disabled={busy}>{busy ? "Membaca…" : "Baca file"}</Button>
    </form>
  );
}
