"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DAY_KEYS, RACE_LABEL, type DayKey, type RaceDistance } from "@/lib/engine/types";
import type { PlanningProfile } from "@/lib/plan/profile";
import { formatRaceTime, parsePaceText, parseRaceTimeFor } from "@/lib/plan/time";
import { cn } from "@/lib/utils";

const DAY_SHORT: Record<DayKey, string> = { mon: "Sen", tue: "Sel", wed: "Rab", thu: "Kam", fri: "Jum", sat: "Sab", sun: "Min" };
const DISTANCES: RaceDistance[] = ["5k", "10k", "hm", "fm"];
const PB_LABEL: Record<RaceDistance, string> = { "5k": "5K", "10k": "10K", hm: "21K (HM)", fm: "42K (FM)" };
const PLACE: Record<RaceDistance, string> = { "5k": "25:30", "10k": "52:00", hm: "1:52:00", fm: "4:05:00" };

const inputCls = "h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-base tabular-nums";
const fmtPace = (s: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function PlanningForm({ initial, logsWeeklyKm }: { initial: PlanningProfile; logsWeeklyKm: number | null }) {
  const router = useRouter();
  const nr = initial.next_race;
  const [raceName, setRaceName] = useState(nr?.name ?? "");
  const [raceDist, setRaceDist] = useState<RaceDistance>(nr?.distance ?? "fm");
  const [raceDate, setRaceDate] = useState(nr?.date ?? "");
  const [raceGoal, setRaceGoal] = useState(nr ? formatRaceTime(nr.goal_time_s) : "");
  const [pbs, setPbs] = useState<Record<RaceDistance, { time: string; date: string }>>(() => Object.fromEntries(
    DISTANCES.map((d) => [d, { time: initial.pbs[d] ? formatRaceTime(initial.pbs[d]!.time_s) : "", date: initial.pbs[d]?.date ?? "" }]),
  ) as Record<RaceDistance, { time: string; date: string }>);
  const [easy, setEasy] = useState(fmtPace(initial.easy_pace_s));
  const [weekly, setWeekly] = useState(initial.weekly_km?.toString() ?? "");
  const [longest, setLongest] = useState(initial.longest_run_km?.toString() ?? "");
  const [days, setDays] = useState<DayKey[]>(initial.run_days);
  const [longDay, setLongDay] = useState<DayKey>(initial.long_day);
  const [hr170, setHr170] = useState(initial.constraints.hr170);
  const [heat, setHeat] = useState(initial.constraints.heat);
  const [injury, setInjury] = useState(initial.constraints.injury ?? "");
  const [notes, setNotes] = useState(initial.constraints.notes ?? "");
  const [errs, setErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const er: string[] = [];
    const num = (s: string) => (s.trim() ? Number(s.replace(",", ".")) : null);
    const pbOut = Object.fromEntries(DISTANCES.map((d) => {
      const t = pbs[d].time.trim();
      if (!t) return [d, null];
      const sec = parseRaceTimeFor(d, t);
      if (sec == null) er.push(`PB ${PB_LABEL[d]}: format waktu belum benar (contoh ${PLACE[d]}).`);
      return [d, sec == null ? null : { time_s: sec, date: pbs[d].date || null }];
    }));
    const easyS = easy.trim() ? parsePaceText(easy) : null;
    if (easy.trim() && easyS == null) er.push("Pace easy: format mm:ss (contoh 6:10).");
    let next = null;
    if (raceName.trim() || raceDate || raceGoal.trim()) {
      const g = parseRaceTimeFor(raceDist, raceGoal);
      if (!raceName.trim()) er.push("Nama race berikutnya belum diisi.");
      if (!raceDate) er.push("Tanggal race berikutnya belum diisi.");
      if (g == null) er.push(`Target waktu belum benar (contoh ${PLACE[raceDist]}).`);
      next = { name: raceName.trim(), distance: raceDist, date: raceDate, goal_time_s: g ?? 0 };
    }
    if (!days.includes(longDay)) er.push("Hari long run harus termasuk hari lari.");
    if (days.length < 3) er.push("Pilih minimal 3 hari lari.");
    setErrs(er);
    if (er.length) return;
    setBusy(true);
    const body = {
      pbs: pbOut, easy_pace_s: easyS, weekly_km: num(weekly), longest_run_km: num(longest),
      run_days: DAY_KEYS.filter((d) => days.includes(d)), long_day: longDay,
      constraints: { hr170, heat, injury: injury.trim() || null, notes: notes.trim() || null },
      next_race: next,
    };
    const res = await fetch("/api/planning", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErrs([d.error ?? "Gagal menyimpan", ...(d.issues ?? [])]);
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4" noValidate>
      <fieldset className="flex flex-col gap-3 rounded-xl border p-3">
        <legend className="px-1 text-sm font-medium">Race berikutnya</legend>
        <Field label="Nama race"><input className={inputCls} value={raceName} onChange={(e) => setRaceName(e.target.value)} placeholder="Jakarta Marathon" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kategori">
            <select className={inputCls} value={raceDist} onChange={(e) => setRaceDist(e.target.value as RaceDistance)}>
              {DISTANCES.map((d) => <option key={d} value={d}>{RACE_LABEL[d]}</option>)}
            </select>
          </Field>
          <Field label="Tanggal"><input type="date" className={inputCls} value={raceDate} onChange={(e) => setRaceDate(e.target.value)} /></Field>
        </div>
        <Field label="Target waktu" hint={raceDist === "hm" || raceDist === "fm" ? "jam:menit atau jam:menit:detik (contoh 3:30)" : "menit:detik (contoh 48:00)"}>
          <input className={inputCls} value={raceGoal} onChange={(e) => setRaceGoal(e.target.value)} placeholder={raceDist === "fm" ? "3:30:00" : PLACE[raceDist]} />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-xl border p-3">
        <legend className="px-1 text-sm font-medium">Performa sekarang</legend>
        <p className="-mt-1 text-xs text-muted-foreground">Personal best — kosongkan jarak yang belum pernah. Tanggal membantu menilai apakah PB masih mewakili kondisi sekarang.</p>
        {DISTANCES.map((d) => (
          <div key={d} className="grid grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-2">
            <span className="pb-3 text-sm">{PB_LABEL[d]}</span>
            <Field label="Waktu"><input aria-label={`PB ${PB_LABEL[d]}`} className={inputCls} value={pbs[d].time} placeholder={PLACE[d]}
              onChange={(e) => setPbs((p) => ({ ...p, [d]: { ...p[d], time: e.target.value } }))} /></Field>
            <Field label="Tanggal (ops.)"><input type="date" aria-label={`Tanggal PB ${PB_LABEL[d]}`} className={inputCls} value={pbs[d].date}
              onChange={(e) => setPbs((p) => ({ ...p, [d]: { ...p[d], date: e.target.value } }))} /></Field>
          </div>
        ))}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Pace easy" hint="mm:ss / km"><input className={inputCls} value={easy} onChange={(e) => setEasy(e.target.value)} placeholder="6:10" /></Field>
          <Field label="Km / minggu" hint={logsWeeklyKm != null ? `log: ±${logsWeeklyKm}` : "rata-rata 4 mgg"}><input inputMode="decimal" className={inputCls} value={weekly} onChange={(e) => setWeekly(e.target.value)} placeholder={logsWeeklyKm?.toString() ?? "35"} /></Field>
          <Field label="Long run terpanjang" hint="km, 4–6 mgg terakhir"><input inputMode="decimal" className={inputCls} value={longest} onChange={(e) => setLongest(e.target.value)} placeholder="18" /></Field>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Hari lari</span>
          <div className="grid grid-cols-7 gap-1">
            {DAY_KEYS.map((d) => (
              <button key={d} type="button" aria-pressed={days.includes(d)}
                onClick={() => setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]))}
                className={cn("h-10 rounded-md border text-xs", days.includes(d) && "border-primary bg-primary text-primary-foreground")}>
                {DAY_SHORT[d]}
              </button>
            ))}
          </div>
        </div>
        <Field label="Hari long run">
          <select className={inputCls} value={longDay} onChange={(e) => setLongDay(e.target.value as DayKey)}>
            {DAY_KEYS.filter((d) => days.includes(d)).map((d) => <option key={d} value={d}>{DAY_SHORT[d]}</option>)}
          </select>
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded-xl border p-3 text-sm">
        <legend className="px-1 font-medium">Kendala</legend>
        <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={hr170} onChange={(e) => setHr170(e.target.checked)} />HR ±170 terasa tidak nyaman (tangga Z4 dimulai lebih rendah)</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={heat} onChange={(e) => setHeat(e.target.checked)} />Latihan di udara panas & lembap</label>
        <Field label="Cedera / riwayat cedera (ops.)" hint="diisi → volume puncak −15% & kenaikan lebih pelan">
          <input className={inputCls} value={injury} onChange={(e) => setInjury(e.target.value)} placeholder="mis. ITB kanan 2025" />
        </Field>
        <Field label="Kendala lain (ops.)">
          <textarea className="min-h-16 rounded-lg border bg-background p-3 text-base" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="mis. kerja shift, hanya bisa pagi" />
        </Field>
      </fieldset>

      {errs.length > 0 && <ul className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{errs.map((x) => <li key={x}>{x}</li>)}</ul>}
      <Button type="submit" className="h-12 text-base" disabled={busy}>{busy ? "Menganalisis…" : "Simpan & analisis"}</Button>
      {saved && !busy && <p className="text-center text-sm text-emerald-700">Tersimpan — lihat analisis di atas.</p>}
    </form>
  );
}
