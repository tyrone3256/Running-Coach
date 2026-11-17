"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/offline/queue";
import { RED_FLAGS, STOP_REASON_LABEL, STOP_REASONS } from "@/lib/log/constants";
import type { Rep, SafetyResult, WorkoutLogInput } from "@/lib/log/schema";
import { formatDuration, parseDuration, parseKm, parsePace } from "@/lib/log/units";
import { formatPace } from "@/lib/engine/pace";
import { cn } from "@/lib/utils";

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

type Initial = Partial<Omit<WorkoutLogInput, "rpe">> & { date: string; rpe?: number | null };

const RPE_HINT: Record<number, string> = {
  1: "sangat ringan", 2: "ringan", 3: "santai, bisa ngobrol", 4: "easy", 5: "mulai terasa",
  6: "moderat", 7: "berat tapi terkontrol", 8: "berat", 9: "sangat berat", 10: "maksimal",
};

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
const intOrNull = (s: string) => {
  const n = num(s);
  return n == null || Number.isNaN(n) ? null : Math.round(n);
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

const inputCls = "h-11 rounded-lg border bg-background px-3 text-base tabular-nums";

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

function emptyRep(i: number): Rep {
  return { index: i, distance_m: null, duration_s: null, pace_s: null, avg_hr: null, max_hr: null,
    hr_drop_60s: null, completed: true, stop_reason: null, stop_at_s: null };
}

export function LogForm({ initial, sessions, quick, importMeta, defaultHrSource = "wrist" }: {
  initial: Initial;
  sessions: SessionOption[];
  quick: boolean;
  importMeta?: ImportMeta;
  defaultHrSource?: "chest" | "wrist";
}) {
  const [date, setDate] = useState(initial.date);
  const session = useMemo(() => sessions.find((s) => s.date === date) ?? null, [sessions, date]);
  const [linkSession, setLinkSession] = useState(initial.session_key !== null);
  const [km, setKm] = useState(
    initial.distance_m != null ? String(+(initial.distance_m / 1000).toFixed(2)) : session ? String(session.planned_km) : "",
  );
  const [dur, setDur] = useState(initial.duration_s ? formatDuration(initial.duration_s) : "");
  const [avgHr, setAvgHr] = useState(initial.avg_hr?.toString() ?? "");
  const [maxHr, setMaxHr] = useState(initial.max_hr?.toString() ?? "");
  const [cad, setCad] = useState(initial.avg_cadence?.toString() ?? "");
  const [hrSource, setHrSource] = useState<"chest" | "wrist">(initial.hr_source ?? defaultHrSource);
  const [rpe, setRpe] = useState<number | null>(initial.rpe ?? null);
  const [hrHard, setHrHard] = useState(initial.discomfort_at_hr?.flag ?? false);
  const [hrHardBpm, setHrHardBpm] = useState(initial.discomfort_at_hr?.bpm?.toString() ?? "");
  const [repInc, setRepInc] = useState(initial.rep_incomplete ?? false);
  const [incRep, setIncRep] = useState("");
  const [incMin, setIncMin] = useState("");
  const [painOn, setPainOn] = useState((initial.pain?.score ?? 0) > 0);
  const [painScore, setPainScore] = useState(initial.pain?.score ?? 0);
  const [painLoc, setPainLoc] = useState(initial.pain?.location ?? "");
  const [painSharp, setPainSharp] = useState(initial.pain?.sharp ?? false);
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [flags, setFlags] = useState<string[]>(initial.red_flags ?? []);
  const [temp, setTemp] = useState(initial.temp_c?.toString() ?? "");
  const [hum, setHum] = useState(initial.humidity?.toString() ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [reps, setReps] = useState<Rep[]>(() => {
    if (initial.reps?.length) return initial.reps;
    return session?.work_reps && session.work_reps > 1 ? Array.from({ length: session.work_reps }, (_, i) => emptyRep(i + 1)) : [];
  });
  const [showDetail, setShowDetail] = useState(!quick);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<null | { queued: true } | { queued: false; safety: SafetyResult; message: string | null; duplicate: boolean }>(null);

  const updateRep = (i: number, patch: Partial<Rep>) =>
    setReps((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function build(): { body?: WorkoutLogInput; errs: string[] } {
    const errs: string[] = [];
    const distance_m = parseKm(km);
    const duration_s = parseDuration(dur);
    if (distance_m == null) errs.push("Jarak belum benar (contoh 10,5).");
    if (duration_s == null || duration_s < 60) errs.push("Durasi belum benar (contoh 58:30 atau 1:02:10).");
    if (rpe == null) errs.push("Pilih RPE.");
    const ah = intOrNull(avgHr);
    if (ah != null && (ah < 40 || ah > 230)) errs.push("Avg HR di luar 40–230.");
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
    // Jangan kirim rep tanpa data yang statusnya tidak diketahui (tidak menebak).
    // Rep sebelum rep yang berhenti dianggap selesai (tersirat dari input user).
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
        avg_cadence: intOrNull(cad),
        rpe: rpe!,
        reps: finalReps,
        time_in_zone: initial.time_in_zone ?? null,
        hr_drop_1min: initial.hr_drop_1min ?? null,
        discomfort_at_hr: { flag: hrHard, bpm: hrHard ? intOrNull(hrHardBpm) : null },
        rep_incomplete: repInc || finalReps.some((r) => !r.completed),
        temp_c: num(temp),
        humidity: num(hum),
        pain: { score: painOn ? painScore : 0, location: painOn && painLoc.trim() ? painLoc.trim() : null, sharp: painOn && painSharp },
        red_flags: flags as WorkoutLogInput["red_flags"],
        notes: notes.trim() || null,
        source: initial.source ?? "manual",
        external_id: initial.external_id ?? null,
        streams: initial.streams ?? null,
      },
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { body, errs } = build();
    setErrors(errs);
    if (!body) return;
    setBusy(true);
    const r = await postJson<{ safety: SafetyResult; message: string | null; duplicate: boolean; error?: string; issues?: Array<{ path: string[]; message: string }> }>("/api/logs", body);
    setBusy(false);
    if (r.status === "queued") return setResult({ queued: true });
    if (!r.ok) {
      setErrors([r.data?.error ?? `Gagal (${r.httpStatus})`, ...(r.data?.issues ?? []).map((i) => `${i.path.join(".")}: ${i.message}`)]);
      return;
    }
    setResult({ queued: false, safety: r.data.safety, message: r.data.message, duplicate: r.data.duplicate });
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
        <p className="text-xs">Feedback coach & penyesuaian program menyusul di milestone berikutnya.</p>
      </Done>
    );
  }

  const paceNow = (() => {
    const d = parseKm(km);
    const t = parseDuration(dur);
    return d && t ? formatPace(t / (d / 1000)) : null;
  })();

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

      <div className="grid grid-cols-3 gap-3">
        <Field label="Jarak (km)">
          <input inputMode="decimal" className={inputCls} value={km} onChange={(e) => setKm(e.target.value)} placeholder="10,5" />
        </Field>
        <Field label="Durasi" hint={paceNow ? `pace ${paceNow}/km` : "mm:ss / h:mm:ss"}>
          <input inputMode="numeric" className={inputCls} value={dur} onChange={(e) => setDur(e.target.value)} placeholder="58:30" />
        </Field>
        <Field label="Avg HR">
          <input inputMode="numeric" className={inputCls} value={avgHr} onChange={(e) => setAvgHr(e.target.value)} placeholder="150" />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-muted-foreground">
          RPE {rpe ? <span className="text-foreground">· {rpe} — {RPE_HINT[rpe]}</span> : "(1–10)"}
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
        {showDetail ? "Sembunyikan detail" : "Detail (max HR, cadence, sensor, cuaca, rep, catatan)"}
      </button>

      {showDetail && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Max HR"><input inputMode="numeric" className={inputCls} value={maxHr} onChange={(e) => setMaxHr(e.target.value)} /></Field>
            <Field label="Cadence"><input inputMode="numeric" className={inputCls} value={cad} onChange={(e) => setCad(e.target.value)} placeholder="spm" /></Field>
            <Field label="Sensor HR">
              <select className={inputCls} value={hrSource} onChange={(e) => setHrSource(e.target.value as "chest" | "wrist")}>
                <option value="wrist">Jam (wrist)</option>
                <option value="chest">Chest strap</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Suhu (°C)"><input inputMode="decimal" className={inputCls} value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="28" /></Field>
            <Field label="Kelembapan (%)"><input inputMode="numeric" className={inputCls} value={hum} onChange={(e) => setHum(e.target.value)} placeholder="80" /></Field>
          </div>

          {reps.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm text-muted-foreground">Rep{session?.rep_label ? ` (${session.rep_label})` : ""}</legend>
              {reps.map((r, i) => (
                <div key={i} className="grid grid-cols-[2rem_1fr_1fr_auto] items-center gap-2">
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
            </fieldset>
          )}

          <Field label="Catatan">
            <textarea className="min-h-20 rounded-lg border bg-background p-3 text-base" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="rep 2 HR 176, panas 30°C…" />
          </Field>
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
