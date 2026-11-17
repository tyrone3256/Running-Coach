"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/offline/queue";
import { RED_FLAGS, STOP_REASON_LABEL, STOP_REASONS } from "@/lib/log/constants";
import type { Rep, SafetyResult, Split, WorkoutLogRawInput, ZoneSeconds } from "@/lib/log/schema";
import { formatDuration, parseDuration, parseKm, parsePace } from "@/lib/log/units";
import { formatHr, formatPace, zoneTable } from "@/lib/engine/pace";
import { cn } from "@/lib/utils";
import { EngineOutcome } from "@/components/engine-outcome";
import type { OutcomeSummary } from "@/lib/data/outcome";

export interface SessionOption {
  id: string;
  date: string;
  label: string;
  planned_km: number;
  work_reps: number | null;
  rep_label: string | null;
}

export interface ImportMeta {
  warnings: string[];
  device: string | null;
  reps_detected: number;
  reps_expected: number;
}

type Initial = Partial<Omit<WorkoutLogRawInput, "rpe">> & { date: string; rpe?: number | null };

const RPE_HINT: Record<number, string> = {
  1: "sangat ringan", 2: "ringan", 3: "santai, bisa ngobrol", 4: "easy", 5: "mulai terasa",
  6: "moderat", 7: "berat tapi terkontrol", 8: "berat", 9: "sangat berat", 10: "maksimal",
};

const ZONES = ["Z1", "Z2", "Z3", "Z4", "Z5"] as const;

const num = (s: string) => {
  if (s.trim() === "") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const intOrNull = (s: string) => {
  const n = num(s);
  return n == null ? null : Math.round(n);
};
const str = (v: number | null | undefined) => (v == null ? "" : String(v));

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

const inputCls = "h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-base tabular-nums";

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={cn(
        "flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm",
        on && "border-primary bg-primary/5 font-medium",
      )}
    >
      {children}
      <span className={cn("h-6 w-10 shrink-0 rounded-full p-0.5 transition", on ? "bg-primary" : "bg-muted")}>
        <span className={cn("block size-5 rounded-full bg-background transition", on && "translate-x-4")} />
      </span>
    </button>
  );
}

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border p-3">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      {note && <p className="-mt-1 text-xs text-muted-foreground">{note}</p>}
      {children}
    </fieldset>
  );
}

function emptyRep(i: number): Rep {
  return { index: i, distance_m: null, duration_s: null, pace_s: null, avg_hr: null, max_hr: null,
    hr_drop_60s: null, completed: true, stop_reason: null, stop_at_s: null };
}

interface SplitRow { pace: string; hr: string }

export function LogForm({ initial, sessions, quick, importMeta, defaultHrSource = "wrist", lthr }: {
  initial: Initial;
  sessions: SessionOption[];
  quick: boolean;
  importMeta?: ImportMeta;
  defaultHrSource?: "chest" | "wrist";
  /** untuk menampilkan batas bpm tiap zona */
  lthr: number;
}) {
  const [date, setDate] = useState(initial.date);
  const session = useMemo(() => sessions.find((s) => s.date === date) ?? null, [sessions, date]);
  const [linkSession, setLinkSession] = useState(initial.session_key !== null);
  // --- ringkasan utama
  const [km, setKm] = useState(
    initial.distance_m != null ? String(+(initial.distance_m / 1000).toFixed(2)) : session ? String(session.planned_km) : "",
  );
  const [dur, setDur] = useState(initial.duration_s ? formatDuration(initial.duration_s) : "");
  const [avgHr, setAvgHr] = useState(str(initial.avg_hr));
  const [maxHr, setMaxHr] = useState(str(initial.max_hr));
  const [cad, setCad] = useState(str(initial.avg_cadence));
  // --- detail Huawei / Strava
  const [elapsed, setElapsed] = useState(initial.elapsed_s ? formatDuration(initial.elapsed_s) : "");
  const [elev, setElev] = useState(str(initial.elevation_gain_m));
  const [kcal, setKcal] = useState(str(initial.calories_kcal));
  const [stride, setStride] = useState(str(initial.avg_stride_cm));
  const [steps, setSteps] = useState(str(initial.total_steps));
  const [load, setLoad] = useState(str(initial.training_load));
  const [aTe, setATe] = useState(str(initial.aerobic_te));
  const [anTe, setAnTe] = useState(str(initial.anaerobic_te));
  const [recov, setRecov] = useState(str(initial.recovery_h));
  const [zoneMin, setZoneMin] = useState<Record<string, string>>(() => Object.fromEntries(
    ZONES.map((z) => [z, initial.time_in_zone ? String(Math.round((initial.time_in_zone[z] / 60) * 10) / 10) : ""]),
  ));
  const [splits, setSplits] = useState<SplitRow[]>(() => (initial.splits ?? []).map((s) => ({
    pace: s.pace_s ? formatPace(s.pace_s) : "", hr: str(s.avg_hr),
  })));
  const [hrSource, setHrSource] = useState<"chest" | "wrist">(initial.hr_source ?? defaultHrSource);
  // --- rasa & keselamatan
  const [rpe, setRpe] = useState<number | null>(initial.rpe ?? null);
  const [hrHard, setHrHard] = useState(initial.discomfort_at_hr?.flag ?? false);
  const [hrHardBpm, setHrHardBpm] = useState(str(initial.discomfort_at_hr?.bpm));
  const [repInc, setRepInc] = useState(initial.rep_incomplete ?? false);
  const [incRep, setIncRep] = useState("");
  const [incMin, setIncMin] = useState("");
  const [painOn, setPainOn] = useState((initial.pain?.score ?? 0) > 0);
  const [painScore, setPainScore] = useState(initial.pain?.score ?? 0);
  const [painLoc, setPainLoc] = useState(initial.pain?.location ?? "");
  const [painSharp, setPainSharp] = useState(initial.pain?.sharp ?? false);
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [flags, setFlags] = useState<string[]>(initial.red_flags ?? []);
  const [temp, setTemp] = useState(str(initial.temp_c));
  const [hum, setHum] = useState(str(initial.humidity));
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [reps, setReps] = useState<Rep[]>(() => {
    if (initial.reps?.length) return initial.reps as Rep[];
    return session?.work_reps && session.work_reps > 1 ? Array.from({ length: session.work_reps }, (_, i) => emptyRep(i + 1)) : [];
  });
  const [showDetail, setShowDetail] = useState(!quick);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<null | { queued: true } | { queued: false; id: string; safety: SafetyResult; message: string | null; duplicate: boolean; engine: OutcomeSummary | null }>(null);

  const zones = useMemo(() => zoneTable(lthr), [lthr]);
  const updateRep = (i: number, patch: Partial<Rep>) =>
    setReps((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const updateSplit = (i: number, patch: Partial<SplitRow>) =>
    setSplits((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const cadNum = intOrNull(cad);
  // Strava (API/web lama) kadang menampilkan cadence per kaki (≈85). Huawei: langkah/menit (≈170).
  const cadFinal = cadNum != null && cadNum > 40 && cadNum < 120 ? cadNum * 2 : cadNum;

  function build(): { body?: WorkoutLogRawInput; errs: string[] } {
    const errs: string[] = [];
    const distance_m = parseKm(km);
    const duration_s = parseDuration(dur);
    if (distance_m == null) errs.push("Jarak belum benar (contoh 10,5).");
    if (duration_s == null || duration_s < 60) errs.push("Durasi belum benar (contoh 58:30 atau 1:02:10).");
    if (rpe == null) errs.push("Pilih RPE.");
    const ah = intOrNull(avgHr);
    if (ah != null && (ah < 40 || ah > 230)) errs.push("Avg HR di luar 40–230.");
    const el = elapsed.trim() ? parseDuration(elapsed) : null;
    if (elapsed.trim() && (el == null || (duration_s != null && el < duration_s))) errs.push("Waktu total harus ≥ waktu bergerak.");
    const ate = num(aTe), ante = num(anTe);
    if ((ate != null && (ate < 0 || ate > 5)) || (ante != null && (ante < 0 || ante > 5))) errs.push("Training Effect 0–5.");

    // zona: hanya dikirim bila ada isian
    const zm = ZONES.map((z) => num(zoneMin[z] ?? ""));
    const time_in_zone: ZoneSeconds | null = zm.some((v) => v != null)
      ? Object.fromEntries(ZONES.map((z, i) => [z, Math.round((zm[i] ?? 0) * 60)])) as ZoneSeconds
      : (initial.time_in_zone ?? null);

    const splitRows: Split[] = [];
    splits.forEach((s, i) => {
      const p = parsePace(s.pace);
      const h = intOrNull(s.hr);
      if (p == null && h == null) return;
      if (s.pace.trim() && p == null) errs.push(`Pace split km ${i + 1} belum benar (contoh 6:05).`);
      splitRows.push({ km: i + 1, distance_m: initial.splits?.[i]?.distance_m ?? null, pace_s: p, avg_hr: h });
    });

    let finalReps = reps;
    const n = repInc && incRep ? Number(incRep) : 0;
    if (n > 0) {
      for (let i = finalReps.length + 1; i <= n; i++) finalReps = [...finalReps, emptyRep(i)];
      finalReps = finalReps.map((r) => r.index === n ? {
        ...r, completed: false,
        stop_at_s: incMin ? Math.round(Number(incMin.replace(",", ".")) * 60) : r.stop_at_s ?? null,
        stop_reason: r.stop_reason ?? (hrHard ? "hr_tidak_nyaman" : "lainnya"),
      } : r);
    }
    // Rep tanpa data yang statusnya tidak diketahui tidak dikirim (tidak menebak).
    const hasData = (r: Rep) => r.pace_s != null || r.avg_hr != null || r.distance_m != null || r.duration_s != null;
    finalReps = finalReps.filter((r) => hasData(r) || !r.completed || (n > 0 && r.index < n));
    if (errs.length) return { errs };
    return {
      errs,
      body: {
        date,
        session_key: linkSession && session ? session.id : null,
        distance_m: distance_m!,
        duration_s: duration_s!,
        avg_hr: ah,
        max_hr: intOrNull(maxHr),
        hr_source: hrSource,
        avg_cadence: cadFinal,
        rpe: rpe!,
        reps: finalReps,
        time_in_zone,
        hr_drop_1min: initial.hr_drop_1min ?? null,
        discomfort_at_hr: { flag: hrHard, bpm: hrHard ? intOrNull(hrHardBpm) : null },
        rep_incomplete: repInc || finalReps.some((r) => !r.completed),
        temp_c: num(temp),
        humidity: num(hum),
        pain: { score: painOn ? painScore : 0, location: painOn && painLoc.trim() ? painLoc.trim() : null, sharp: painOn && painSharp },
        red_flags: flags as WorkoutLogRawInput["red_flags"],
        notes: notes.trim() || null,
        source: initial.source ?? "manual",
        external_id: initial.external_id ?? null,
        streams: initial.streams ?? null,
        elapsed_s: el,
        elevation_gain_m: num(elev),
        calories_kcal: intOrNull(kcal),
        avg_stride_cm: num(stride),
        total_steps: intOrNull(steps),
        training_load: num(load),
        aerobic_te: ate,
        anaerobic_te: ante,
        recovery_h: num(recov),
        splits: splitRows,
      },
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { body, errs } = build();
    setErrors(errs);
    if (!body) return;
    setBusy(true);
    const r = await postJson<{ id: string; safety: SafetyResult; message: string | null; duplicate: boolean; engine: OutcomeSummary | null; error?: string; issues?: Array<{ path: string[]; message: string }> }>("/api/logs", body);
    setBusy(false);
    if (r.status === "queued") return setResult({ queued: true });
    if (!r.ok) {
      setErrors([r.data?.error ?? `Gagal (${r.httpStatus})`, ...(r.data?.issues ?? []).map((i) => `${i.path.join(".")}: ${i.message}`)]);
      return;
    }
    setResult({ queued: false, id: r.data.id, safety: r.data.safety, message: r.data.message, duplicate: r.data.duplicate, engine: r.data.engine });
  }

  if (result) {
    if (result.queued) {
      return <Done tone="amber" title="Tersimpan di HP">Belum ada sinyal. Log dikirim otomatis saat online.</Done>;
    }
    if (result.safety.level === "stop") {
      return (
        <Done tone="red" title="STOP — periksa ke dokter">
          <p>{result.message}</p>
          <p className="mt-2 text-xs">Tercatat: {result.safety.reasons.join(", ")}</p>
        </Done>
      );
    }
    return (
      <Done tone={result.safety.level === "medical_check" ? "amber" : "green"} title={result.duplicate ? "Sudah pernah diimport" : "Log tersimpan"}>
        {result.safety.level === "medical_check" && (
          <p>Nyeri tercatat ({result.safety.reasons.join(", ")}). Sesi kualitas berikutnya sebaiknya ditunda dan cek ke dokter/fisioterapis bila tidak membaik dalam 2 hari.</p>
        )}
        <EngineOutcome o={result.engine} />
        <Link href={`/log/${result.id}`} className="font-medium underline">Lihat feedback coach →</Link>
      </Done>
    );
  }

  const paceNow = (() => {
    const d = parseKm(km);
    const t = parseDuration(dur);
    return d && t ? formatPace(t / (d / 1000)) : null;
  })();
  const kmCount = Math.min(60, Math.ceil(parseKm(km) ? parseKm(km)! / 1000 : 0));

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {importMeta && (
        <div className="rounded-lg bg-muted p-3 text-xs">
          <p>
            Dari file{importMeta.device ? ` (${importMeta.device})` : ""}
            {importMeta.reps_expected > 0 && ` · rep terdeteksi ${importMeta.reps_detected}/${importMeta.reps_expected}`}
          </p>
          {importMeta.warnings.map((w) => <p key={w} className="text-amber-700 dark:text-amber-400">⚠ {w}</p>)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Tanggal">
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Sesi">
          <span className="flex h-11 items-center text-sm">
            {session ? (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={linkSession} onChange={(e) => setLinkSession(e.target.checked)} className="size-4" />
                <span className="truncate">{session.id}</span>
              </label>
            ) : <span className="text-muted-foreground">di luar program</span>}
          </span>
        </Field>
      </div>
      {session && linkSession && <p className="-mt-2 text-xs text-muted-foreground">{session.label} · rencana {session.planned_km.toLocaleString("id-ID")} km</p>}

      <Section title="Ringkasan" note="Salin dari layar ringkasan aktivitas di Huawei Health / Strava.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Jarak (km)">
            <input inputMode="decimal" className={inputCls} value={km} onChange={(e) => setKm(e.target.value)} placeholder="10,5" />
          </Field>
          <Field label="Waktu bergerak" hint={paceNow ? `pace rata-rata ${paceNow}/km` : "Huawei: Durasi · Strava: Moving Time"}>
            <input inputMode="numeric" className={inputCls} value={dur} onChange={(e) => setDur(e.target.value)} placeholder="58:30" />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="HR rata-rata">
            <input inputMode="numeric" className={inputCls} value={avgHr} onChange={(e) => setAvgHr(e.target.value)} placeholder="150" />
          </Field>
          <Field label="HR maks">
            <input inputMode="numeric" className={inputCls} value={maxHr} onChange={(e) => setMaxHr(e.target.value)} placeholder="168" />
          </Field>
          <Field label="Kadens" hint={cadFinal !== cadNum && cadFinal ? `= ${cadFinal} langkah/menit` : "langkah/menit"}>
            <input inputMode="numeric" className={inputCls} value={cad} onChange={(e) => setCad(e.target.value)} placeholder="172" />
          </Field>
        </div>
      </Section>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-muted-foreground">
          RPE / Perceived Exertion {rpe ? <span className="text-foreground">· {rpe} — {RPE_HINT[rpe]}</span> : "(1–10)"}
        </legend>
        <div className="grid grid-cols-10 gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" onClick={() => setRpe(n)} aria-pressed={rpe === n}
              className={cn("h-10 rounded-md border text-sm tabular-nums", rpe === n && "border-primary bg-primary text-primary-foreground")}>
              {n}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Toggle on={hrHard} onChange={setHrHard}>HR 170 terasa berat</Toggle>
        {hrHard && (
          <Field label="Mulai berat di HR berapa?">
            <input inputMode="numeric" className={inputCls} value={hrHardBpm} onChange={(e) => setHrHardBpm(e.target.value)} placeholder="170" />
          </Field>
        )}
        <Toggle on={repInc} onChange={setRepInc}>Rep tidak selesai</Toggle>
        {repInc && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Berhenti di rep ke-">
              <input inputMode="numeric" className={inputCls} value={incRep} onChange={(e) => setIncRep(e.target.value)} placeholder="2" />
            </Field>
            <Field label="di menit ke-">
              <input inputMode="decimal" className={inputCls} value={incMin} onChange={(e) => setIncMin(e.target.value)} placeholder="6" />
            </Field>
          </div>
        )}
        <Toggle on={painOn} onChange={setPainOn}>Ada nyeri</Toggle>
        {painOn && (
          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <Field label={`Skor nyeri: ${painScore}/10`}>
              <input type="range" min={0} max={10} value={painScore} onChange={(e) => setPainScore(Number(e.target.value))} />
            </Field>
            <Field label="Lokasi">
              <input className={inputCls} value={painLoc} onChange={(e) => setPainLoc(e.target.value)} placeholder="betis kiri" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={painSharp} onChange={(e) => setPainSharp(e.target.checked)} />
              Nyeri tajam / di satu titik
            </label>
          </div>
        )}
        <button type="button" onClick={() => setFlagsOpen(!flagsOpen)}
          className={cn("min-h-11 rounded-lg border px-3 text-left text-sm", flags.length && "border-destructive text-destructive")}>
          {flags.length ? `⚠ ${flags.length} gejala bahaya ditandai` : "Ada gejala bahaya? (nyeri dada, pingsan, …)"}
        </button>
        {flagsOpen && (
          <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3 text-sm">
            {RED_FLAGS.map((f) => (
              <label key={f.id} className="flex items-center gap-2">
                <input type="checkbox" className="size-4" checked={flags.includes(f.id)}
                  onChange={(e) => setFlags((xs) => (e.target.checked ? [...xs, f.id] : xs.filter((x) => x !== f.id)))} />
                {f.label}
              </label>
            ))}
          </div>
        )}
      </div>

      <button type="button" onClick={() => setShowDetail(!showDetail)} className="text-left text-sm text-muted-foreground underline">
        {showDetail ? "Sembunyikan detail" : "Detail Huawei Health / Strava (zona HR, split, elevasi, Training Effect, rep…)"}
      </button>

      {showDetail && (
        <div className="flex flex-col gap-4">
          <Section title="Waktu & lintasan">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Waktu total" hint="Strava: Elapsed">
                <input inputMode="numeric" className={inputCls} value={elapsed} onChange={(e) => setElapsed(e.target.value)} placeholder="1:01:20" />
              </Field>
              <Field label="Elevasi naik (m)">
                <input inputMode="decimal" className={inputCls} value={elev} onChange={(e) => setElev(e.target.value)} placeholder="25" />
              </Field>
              <Field label="Kalori (kkal)">
                <input inputMode="numeric" className={inputCls} value={kcal} onChange={(e) => setKcal(e.target.value)} placeholder="650" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Panjang langkah (cm)">
                <input inputMode="decimal" className={inputCls} value={stride} onChange={(e) => setStride(e.target.value)} placeholder="102" />
              </Field>
              <Field label="Total langkah">
                <input inputMode="numeric" className={inputCls} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="9800" />
              </Field>
            </div>
          </Section>

          <Section title="Huawei Health: efek latihan" note="Isi bila tampil di jam/aplikasi; boleh dikosongkan.">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Training load"><input inputMode="decimal" className={inputCls} value={load} onChange={(e) => setLoad(e.target.value)} placeholder="120" /></Field>
              <Field label="Waktu pemulihan (jam)"><input inputMode="decimal" className={inputCls} value={recov} onChange={(e) => setRecov(e.target.value)} placeholder="24" /></Field>
              <Field label="Aerobic TE (0–5)"><input inputMode="decimal" className={inputCls} value={aTe} onChange={(e) => setATe(e.target.value)} placeholder="3,2" /></Field>
              <Field label="Anaerobic TE (0–5)"><input inputMode="decimal" className={inputCls} value={anTe} onChange={(e) => setAnTe(e.target.value)} placeholder="1,1" /></Field>
            </div>
          </Section>

          <Section
            title="Waktu di zona HR (menit)"
            note={`Zona program (% LTHR ${lthr}). Isi hanya bila batas zona di Huawei/Strava sudah disamakan dengan angka ini — lihat ⚙ Pengaturan → Zona HR.`}
          >
            <div className="grid grid-cols-5 gap-2">
              {zones.map((z) => (
                <Field key={z.zone} label={z.zone} hint={formatHr(z.bpm)}>
                  <input inputMode="decimal" aria-label={`Menit ${z.zone}`} className={cn(inputCls, "px-2")} value={zoneMin[z.zone]}
                    onChange={(e) => setZoneMin((m) => ({ ...m, [z.zone]: e.target.value }))} />
                </Field>
              ))}
            </div>
          </Section>

          <Section title="Split per km" note="Huawei: tab Pace · Strava: Splits. Pace wajib, HR opsional.">
            {splits.length === 0 ? (
              <Button type="button" variant="outline" className="self-start" disabled={kmCount === 0}
                onClick={() => setSplits(Array.from({ length: kmCount }, () => ({ pace: "", hr: "" })))}>
                Isi split {kmCount ? `(${kmCount} km)` : ""}
              </Button>
            ) : (
              <div className="flex flex-col gap-1">
                {splits.map((s, i) => (
                  <div key={i} className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
                    <span className="text-sm tabular-nums text-muted-foreground">km {i + 1}</span>
                    <input aria-label={`Pace km ${i + 1}`} className={cn(inputCls, "h-10")} placeholder="6:05"
                      value={s.pace} onChange={(e) => updateSplit(i, { pace: e.target.value })} />
                    <input aria-label={`HR km ${i + 1}`} inputMode="numeric" className={cn(inputCls, "h-10")} placeholder="HR"
                      value={s.hr} onChange={(e) => updateSplit(i, { hr: e.target.value })} />
                  </div>
                ))}
                <div className="flex gap-4 pt-1 text-xs">
                  <button type="button" className="underline" onClick={() => setSplits((ss) => [...ss, { pace: "", hr: "" }])}>+ km</button>
                  <button type="button" className="underline" onClick={() => setSplits((ss) => ss.slice(0, -1))}>− km</button>
                </div>
              </div>
            )}
          </Section>

          {reps.length > 0 && (
            <Section title={`Interval / rep${session?.rep_label ? ` (${session.rep_label})` : ""}`} note="Huawei: Lap/Interval · Strava: Laps.">
              {reps.map((r, i) => (
                <div key={i} className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                  <span className="text-sm tabular-nums">#{r.index}</span>
                  <input aria-label={`Pace rep ${r.index}`} className={cn(inputCls, "h-10")} placeholder="pace 4:50"
                    defaultValue={r.pace_s ? formatPace(r.pace_s) : ""}
                    onBlur={(e) => updateRep(i, { pace_s: parsePace(e.target.value) })} />
                  <input aria-label={`HR rep ${r.index}`} inputMode="numeric" className={cn(inputCls, "h-10")} placeholder="HR"
                    defaultValue={r.avg_hr ?? ""} onBlur={(e) => updateRep(i, { avg_hr: intOrNull(e.target.value) })} />
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" className="size-4" checked={r.completed}
                      onChange={(e) => updateRep(i, { completed: e.target.checked, stop_reason: e.target.checked ? null : r.stop_reason ?? "lainnya" })} />
                    selesai
                  </label>
                  {!r.completed && (
                    <select aria-label={`Alasan berhenti rep ${r.index}`} className={cn(inputCls, "col-span-3 col-start-2 h-10 text-sm")}
                      value={r.stop_reason ?? "lainnya"} onChange={(e) => updateRep(i, { stop_reason: e.target.value as Rep["stop_reason"] })}>
                      {STOP_REASONS.map((s) => <option key={s} value={s}>{STOP_REASON_LABEL[s]}</option>)}
                    </select>
                  )}
                </div>
              ))}
            </Section>
          )}

          <Section title="Kondisi">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Suhu (°C)"><input inputMode="decimal" className={inputCls} value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="28" /></Field>
              <Field label="Lembap (%)"><input inputMode="numeric" className={inputCls} value={hum} onChange={(e) => setHum(e.target.value)} placeholder="80" /></Field>
              <Field label="Sensor HR">
                <select className={inputCls} value={hrSource} onChange={(e) => setHrSource(e.target.value as "chest" | "wrist")}>
                  <option value="wrist">Jam</option>
                  <option value="chest">Chest strap</option>
                </select>
              </Field>
            </div>
            <Field label="Catatan">
              <textarea className="min-h-20 rounded-lg border bg-background p-3 text-base" value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="rep 2 HR 176, panas 30°C…" />
            </Field>
          </Section>
        </div>
      )}

      {errors.length > 0 && (
        <ul className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      <Button type="submit" className="h-12 text-base" disabled={busy}>{busy ? "Menyimpan…" : "Simpan log"}</Button>
    </form>
  );
}

function Done({ tone, title, children }: { tone: "green" | "amber" | "red"; title: string; children: React.ReactNode }) {
  const cls = {
    green: "border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/40",
    amber: "border-amber-500/40 bg-amber-50 dark:bg-amber-950/40",
    red: "border-destructive bg-destructive/10 text-destructive",
  }[tone];
  return (
    <div role={tone === "red" ? "alert" : "status"} className={cn("flex flex-col gap-3 rounded-xl border p-4 text-sm", cls)}>
      <p className="text-lg font-semibold">{title}</p>
      <div className="flex flex-col gap-2">{children}</div>
      <div className="flex gap-4 pt-1">
        <Link href="/log" className="underline">Lihat log</Link>
        <Link href="/" className="underline">Hari ini</Link>
      </div>
    </div>
  );
}
