// Helper analisis untuk rules. Murni.
import type { EngineState, PlanSnapshot } from "./model";
import type { PaceProfile, Segment, Session, SessionType } from "./types";
import { isActive } from "./snapshot";
import { parseZoneTag, resolvePace, HR_ZONES_PCT } from "./pace";
import { addDays, daysBetween } from "@/lib/dates";
import type { WorkoutLog } from "@/lib/log/schema";

export const EASY_TYPES: SessionType[] = [
  "easy", "easy_strides", "easy_hill", "recovery", "long", "shakeout",
];
export const QUALITY_TYPES: SessionType[] = ["vo2_4x4", "tempo", "hm_pace"];
export const LADDER_TYPES: SessionType[] = ["tempo", "hm_pace"];

/** Cue protokol HR 170 dari sheet 🫀 Solusi HR 170. */
export const CUES_HR170 = [
  "2 menit pertama rep jangan kejar pace — start 5 dtk/km lebih lambat, biarkan HR naik pelan, lalu masuk target.",
  "HR lewat batas atas Z4 sebelum rep selesai → pelankan 5–10 dtk/km dan SELESAIKAN rep. Rep selesai sedikit lambat lebih baik daripada berhenti.",
  "Napas 2:2 di tempo (2:1 di 4×4), fokus buang napas panjang; bahu & rahang rileks.",
  "Cadence 170–180, langkah pendek-cepat.",
  "Chunking: pecah rep jadi potongan 1 menit / 500 m, hitung napas, 1 kata kunci ('rileks').",
  "Jog recovery: mulai rep berikut saat HR < 80% LTHR; belum turun setelah ±3′ → cukup sampai rep itu.",
];

export const sessionOf = (s: PlanSnapshot, log: WorkoutLog): Session | undefined =>
  log.session_key ? s.sessions.find((x) => x.id === log.session_key) : undefined;

// ------------------------------------------------------------------ R9 panas
export function isHot(temp: number | null | undefined, hum: number | null | undefined): boolean {
  return temp != null && hum != null && temp >= 28 && hum >= 70;
}
/** Penyesuaian tampilan pace easy/long (dtk/km) saat panas & lembap: +10…+20. */
export function heatAdjustment(temp: number | null | undefined, hum: number | null | undefined): number {
  if (!isHot(temp, hum)) return 0;
  if (temp! < 30) return 10;
  if (temp! < 32) return 15;
  return 20;
}

// ------------------------------------------------------------------ R13 sensor
export function sensorCheck(log: WorkoutLog): { suspect: boolean; reason: string | null } {
  if (log.hr_source !== "wrist" || log.avg_hr == null) return { suspect: false, reason: null };
  if (log.avg_cadence != null && Math.abs(log.avg_hr - log.avg_cadence) <= 3) {
    return { suspect: true, reason: `avg HR ${log.avg_hr} ≈ cadence ${log.avg_cadence} (kemungkinan cadence lock)` };
  }
  const st = log.streams;
  if (st && st.t.length > 4) {
    // kecepatan SEBELUM titik i (jendela [i-3, i]) dan SESUDAH titik j (jendela [j, j+3])
    const speedBetween = (j0: number, j1: number) => {
      j0 = Math.max(0, j0);
      j1 = Math.min(st.t.length - 1, j1);
      const d0 = st.d[j0];
      const d1 = st.d[j1];
      const dt = st.t[j1] - st.t[j0];
      return d0 != null && d1 != null && dt > 0 ? (d1 - d0) / dt : null;
    };
    for (let i = 0; i < st.t.length; i++) {
      const h0 = st.hr[i];
      if (h0 == null) continue;
      for (let j = i + 1; j < st.t.length && st.t[j] - st.t[i] < 30; j++) {
        const h1 = st.hr[j];
        if (h1 == null || Math.abs(h1 - h0) <= 20) continue;
        const v0 = speedBetween(i - 3, i);
        const v1 = speedBetween(j, j + 3);
        if (v0 && v1 && Math.abs(v1 - v0) / v0 < 0.1) {
          return {
            suspect: true,
            reason: `HR melonjak ${h0}→${h1} bpm dalam ${st.t[j] - st.t[i]} dtk tanpa perubahan pace`,
          };
        }
      }
    }
  }
  return { suspect: false, reason: null };
}

export const hrUsable = (log: WorkoutLog) => log.avg_hr != null && !sensorCheck(log).suspect;

// ------------------------------------------------------------------ zona
export function zoneBpm(tag: string, lthr: number): { lo: number; hi: number; mid: number } {
  const [a, b] = parseZoneTag(tag);
  const lo = (lthr * HR_ZONES_PCT[a][0]) / 100;
  const hi = (lthr * HR_ZONES_PCT[b][1]) / 100;
  return { lo: Math.round(lo), hi: Math.round(hi), mid: (Math.max(lo, lthr * 0.8) + hi) / 2 };
}

export function workSegment(session: Session): Segment | undefined {
  return session.segments.find((g) => g.kind === "work");
}

// ------------------------------------------------------------------ R3/R4 penilaian sesi kualitas
export interface QualityAssessment {
  failed: boolean;
  reasons: string[];
  /** sukses untuk R4: on-pace, HR ≤ tengah zona, RPE ≤7 */
  easySuccess: boolean;
  meanRepPace: number | null;
  hot: boolean;
  /** rep 4×4 dibatalkan karena HR tak turun saat recovery (dicatat, bukan gagal) */
  cancelledForRecovery: number;
  /** gagal di tangga Z4 karena HR/tidak nyaman (R12) */
  ladderFailure: boolean;
}

export function assessQuality(log: WorkoutLog, session: Session, profile: PaceProfile, lthr: number): QualityAssessment {
  const work = workSegment(session);
  const reasons: string[] = [];
  const hot = isHot(log.temp_c, log.humidity);
  const usable = hrUsable(log);
  const reps = log.reps;
  const target = work ? resolvePace(work, profile, session.week) : null;
  const paced = reps.filter((r) => r.pace_s != null);
  const meanRepPace = paced.length
    ? paced.reduce((a, r) => a + r.pace_s! * (r.duration_s ?? 1), 0) / paced.reduce((a, r) => a + (r.duration_s ?? 1), 0)
    : null;

  // a) pace >3% lebih lambat dari batas lambat target (tidak dinilai saat panas — R9)
  if (target && meanRepPace != null && !hot && meanRepPace > target[1] * 1.03) {
    reasons.push(`rep rata-rata ${Math.round(meanRepPace)} dtk/km > target ${target[1]} +3%`);
  }
  // b) HR > batas atas zona +3 bpm di >50% waktu rep
  if (work?.hr_zone && usable) {
    const { hi } = zoneBpm(work.hr_zone, lthr);
    const withHr = reps.filter((r) => r.avg_hr != null);
    const w = (r: (typeof reps)[number]) => r.duration_s ?? 1;
    const total = withHr.reduce((a, r) => a + w(r), 0);
    const over = withHr.filter((r) => r.avg_hr! > hi + 3).reduce((a, r) => a + w(r), 0);
    if (total > 0 && over / total > 0.5) reasons.push(`HR > ${hi + 3} bpm di >50% waktu rep`);
  }
  // c) rep tidak selesai (kecuali 4×4 yang dibatalkan karena recovery HR — R12)
  const cancelled = reps.filter((r) => !r.completed && r.stop_reason === "hr_recovery_slow").length;
  const incomplete = reps.filter((r) => !r.completed && r.stop_reason !== "hr_recovery_slow").length;
  if (incomplete > 0 || (log.rep_incomplete && reps.length === 0)) reasons.push("rep tidak selesai");
  // d) RPE ≥9 untuk tempo / HM pace
  if ((session.type === "tempo" || session.type === "hm_pace") && log.rpe >= 9) reasons.push(`RPE ${log.rpe}`);

  const ladderFailure = LADDER_TYPES.includes(session.type) && (
    reps.some((r) => !r.completed && r.stop_reason === "hr_tidak_nyaman")
    || (log.rep_incomplete && log.discomfort_at_hr.flag)
  );

  let easySuccess = false;
  if (work?.hr_zone && usable && target && meanRepPace != null && reasons.length === 0) {
    const { mid } = zoneBpm(work.hr_zone, lthr);
    const repHr = reps.filter((r) => r.avg_hr != null);
    const hr = repHr.length ? repHr.reduce((a, r) => a + r.avg_hr!, 0) / repHr.length : null;
    easySuccess = meanRepPace <= target[1] && hr != null && hr <= mid && log.rpe <= 7;
  }
  return { failed: reasons.length > 0, reasons, easySuccess, meanRepPace, hot, cancelledForRecovery: cancelled, ladderFailure };
}

// ------------------------------------------------------------------ util state
export function logsWithSession(state: EngineState) {
  return state.logs
    .map((log) => ({ log, session: sessionOf(state.snapshot, log) }))
    .filter((x): x is { log: WorkoutLog; session: Session } => !!x.session)
    .sort((a, b) => a.log.date.localeCompare(b.log.date) || a.log.created_at.localeCompare(b.log.created_at));
}

/** Tanggal terakhir sebuah rule menghasilkan perubahan yang diterapkan (untuk jendela evaluasi). */
export function lastAppliedDate(state: EngineState, rules: string[], codes?: string[]): string | null {
  const hits = state.changes.filter((c) =>
    rules.includes(c.rule) && (c.mode === "auto" || c.mode === "approved") && !c.reverted_by
    && (!codes || c.changes.some((ch) => ch.op === "shift_pace" && ch.codes.some((x) => codes.includes(x)))));
  return hits.map((c) => c.date).sort().pop() ?? null;
}

export function nextSessionOfTypes(snapshot: PlanSnapshot, after: string, types: SessionType[]): Session | undefined {
  return snapshot.sessions.find((s) => isActive(s) && s.date > after && types.includes(s.type));
}

export function sessionOnDate(snapshot: PlanSnapshot, date: string): Session | undefined {
  return snapshot.sessions.find((s) => isActive(s) && s.date === date);
}

export function weekOfDate(snapshot: PlanSnapshot, date: string) {
  return snapshot.weeks.slice().reverse().find((w) => w.start <= date && daysBetween(w.start, date) < 7);
}

export const plus = addDays;
