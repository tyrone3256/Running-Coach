// Coach berbasis aturan (tanpa AI, tanpa biaya): feedback per log dari data + aturan program.
// Fungsi murni → bisa diuji. Kalimat singkat, berbasis angka, konservatif soal cedera.
import type { EngineState, PlanChangeRecord } from "@/lib/engine/model";
import type { Session } from "@/lib/engine/types";
import type { WorkoutLog } from "@/lib/log/schema";
import {
  CUES_HR170, EASY_TYPES, LADDER_TYPES, QUALITY_TYPES, assessQuality, heatAdjustment, isHot, sensorCheck, sessionOf, zoneBpm,
} from "@/lib/engine/analysis";
import { formatPace, plannedZ4Minutes, resolvePace } from "@/lib/engine/pace";
import { isActive } from "@/lib/engine/snapshot";
import { SESSION_LABEL } from "@/lib/labels";
import { STOP_MESSAGE } from "@/lib/log/safety";
import { formatDateId } from "@/lib/dates";

export type Tone = "good" | "info" | "warn" | "stop";

export interface Point {
  tone: Tone;
  text: string;
}

export interface Feedback {
  tone: Tone;
  headline: string;
  points: Point[];
  cues: string[];
  /** perubahan plan yang dipicu log ini (engine) */
  changes: string[];
  next: string | null;
}

const kmFmt = (m: number) => (m / 1000).toLocaleString("id-ID", { maximumFractionDigits: 2 });
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Segmen utama sesi easy/long: steady/long dengan jarak terbesar. */
function mainSegment(s: Session) {
  return s.segments
    .filter((g) => g.kind !== "warmup" && g.kind !== "cooldown" && g.kind !== "strides" && g.kind !== "hill")
    .sort((a, b) => (b.distance_m ?? 0) - (a.distance_m ?? 0))[0];
}

/** Analisis split per km: pacing (paruh 1 vs 2) dan cardiac drift. */
export function splitAnalysis(log: WorkoutLog): Point[] {
  const sp = log.splits.filter((s) => s.pace_s != null && (s.distance_m == null || s.distance_m >= 900));
  if (sp.length < 4) return [];
  const half = Math.floor(sp.length / 2);
  const a = sp.slice(0, half), b = sp.slice(sp.length - half);
  const avg = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
  const p1 = avg(a.map((s) => s.pace_s!)), p2 = avg(b.map((s) => s.pace_s!));
  const out: Point[] = [];
  const diff = (p2 - p1) / p1;
  if (diff > 0.03) out.push({ tone: "info", text: `Melambat di paruh akhir: ${formatPace(p1)} → ${formatPace(p2)}/km (+${Math.round(p2 - p1)} dtk). Mulai lebih pelan supaya akhir tetap stabil.` });
  else if (diff < -0.03) out.push({ tone: "good", text: `Negative split: ${formatPace(p1)} → ${formatPace(p2)}/km. Bagus — terutama untuk long run.` });
  else out.push({ tone: "good", text: `Pacing rata: paruh 1 ${formatPace(p1)}, paruh 2 ${formatPace(p2)}/km.` });

  const h1 = a.filter((s) => s.avg_hr != null), h2 = b.filter((s) => s.avg_hr != null);
  if (h1.length >= 2 && h2.length >= 2 && Math.abs(diff) <= 0.03 && !sensorCheck(log).suspect) {
    const hr1 = avg(h1.map((s) => s.avg_hr!)), hr2 = avg(h2.map((s) => s.avg_hr!));
    const drift = (hr2 - hr1) / hr1;
    if (drift > 0.05) {
      out.push({ tone: "warn", text: `Cardiac drift ${pct(drift)} (HR ${Math.round(hr1)} → ${Math.round(hr2)} di pace sama). Biasanya panas/dehidrasi atau basis aerobik belum cukup — minum lebih awal, lari lebih pagi.` });
    } else if (drift >= 0) {
      out.push({ tone: "good", text: `HR stabil di pace sama (drift ${pct(drift)}) — tanda basis aerobik baik.` });
    }
  }
  return out;
}

function engineChanges(state: EngineState, log: WorkoutLog): PlanChangeRecord[] {
  const t0 = Date.parse(log.created_at);
  return state.changes.filter((c) => {
    if (c.key.includes(log.id)) return true;
    const ev = c.evidence as { logs?: string[] } | undefined;
    if (ev?.logs?.includes(log.id)) return true;
    const t = Date.parse(c.created_at);
    return c.rule !== "manual" && t >= t0 && t - t0 < 120_000;
  });
}

export function feedbackForLog(log: WorkoutLog, state: EngineState): Feedback {
  if (log.safety.level === "stop") {
    return { tone: "stop", headline: "STOP — periksa ke dokter", points: [{ tone: "stop", text: STOP_MESSAGE }], cues: [], changes: [], next: null };
  }
  const snap = state.snapshot;
  const s = sessionOf(snap, log);
  const points: Point[] = [];
  const cues = new Set<string>();
  const sensor = sensorCheck(log);
  const hot = isHot(log.temp_c, log.humidity);
  const paceTxt = log.avg_pace_s ? `${formatPace(log.avg_pace_s)}/km` : "–";

  if (log.safety.level === "medical_check") {
    points.push({ tone: "warn", text: `Nyeri tercatat (${log.safety.reasons.join(", ")}). Sesi kualitas ditunda dulu; ke dokter/fisioterapis bila tajam, di satu titik, atau tidak membaik dalam 2 hari.` });
  }
  if (sensor.suspect) {
    points.push({ tone: "warn", text: `HR kemungkinan tidak akurat: ${sensor.reason}. Penilaian berbasis HR dilewati; chest strap membantu.` });
  }
  if (hot) {
    points.push({ tone: "info", text: `Panas (${log.temp_c ?? "?"}°C, ${log.humidity ?? "?"}%): pace easy boleh +${heatAdjustment(log.temp_c, log.humidity)} dtk/km, nilai dari HR & rasa.` });
  }

  let headline: string;
  let tone: Tone = "good";

  if (!s) {
    headline = `Lari di luar program · ${kmFmt(log.distance_m)} km @ ${paceTxt}`;
    if (log.rpe >= 7) points.push({ tone: "warn", text: `RPE ${log.rpe} di luar program menambah beban — pastikan sesi berikutnya tetap sesuai rencana.` });
  } else {
    headline = `${SESSION_LABEL[s.type]} · ${kmFmt(log.distance_m)} / ${s.planned_km.toLocaleString("id-ID")} km @ ${paceTxt}`;
    const ratio = log.distance_m / 1000 / (s.planned_km || 1);
    if (ratio < 0.85) points.push({ tone: "info", text: `Volume ${pct(ratio)} dari rencana. Sekali tidak apa; kalau sering, beri tahu lewat check-in (capek/sakit?).` });
    else if (ratio > 1.15) points.push({ tone: "warn", text: `Volume ${pct(ratio)} dari rencana. Tambahan km di luar program menaikkan risiko cedera — cukup sesuai rencana.` });

    if (EASY_TYPES.includes(s.type) || s.type.startsWith("long")) {
      const seg = mainSegment(s);
      const target = seg ? resolvePace(seg, snap.paceProfile, s.week) : null;
      if (target && log.avg_pace_s) {
        const adj = hot ? heatAdjustment(log.temp_c, log.humidity) : 0;
        if (log.avg_pace_s < target[0] - 5) {
          tone = "warn";
          points.push({ tone: "warn", text: `Terlalu cepat untuk ${SESSION_LABEL[s.type].toLowerCase()}: ${paceTxt} vs target ${formatPace(target[0])}–${formatPace(target[1] + adj)}. Easy yang benar-benar easy = sesi kualitas lebih segar.` });
        } else if (log.avg_pace_s <= target[1] + adj + 10) {
          points.push({ tone: "good", text: `Pace sesuai target (${formatPace(target[0])}–${formatPace(target[1] + adj)}/km).` });
        }
      }
      if (seg?.hr_zone && log.avg_hr && !sensor.suspect) {
        const { hi } = zoneBpm(seg.hr_zone, snap.lthr);
        if (log.avg_hr > hi + 2) {
          tone = "warn";
          points.push({ tone: "warn", text: `HR rata-rata ${log.avg_hr} di atas batas ${seg.hr_zone} (≤${hi}). Pelankan sampai HR turun — pace mengikuti HR, bukan sebaliknya.` });
        } else {
          points.push({ tone: "good", text: `HR rata-rata ${log.avg_hr} dalam ${seg.hr_zone} (≤${hi}).` });
        }
      }
      if (log.rpe >= 6 && !s.type.startsWith("long")) points.push({ tone: "warn", text: `RPE ${log.rpe} terlalu tinggi untuk easy — cek tidur, panas, atau pace.` });
      if (log.aerobic_te != null && log.aerobic_te >= 4 && !s.type.startsWith("long")) {
        points.push({ tone: "warn", text: `Aerobic TE ${String(log.aerobic_te).replace(".", ",")} untuk easy run = beban besar. Easy idealnya TE ±2–3.` });
      }
    }

    if (QUALITY_TYPES.includes(s.type)) {
      const q = assessQuality(log, s, snap.paceProfile, snap.lthr);
      const z4Plan = s.z4_target_min ?? Math.round(plannedZ4Minutes(s, snap.paceProfile));
      const z4Done = log.time_in_zone ? Math.round(log.time_in_zone.Z4 / 60) : null;
      const done = log.reps.filter((r) => r.completed).length;
      if (log.reps.length) points.push({ tone: done === log.reps.length ? "good" : "info", text: `Rep selesai ${done}/${log.reps.length}${q.meanRepPace ? ` · rata-rata ${formatPace(q.meanRepPace)}/km` : ""}.` });
      if (z4Done != null && z4Plan) {
        points.push({ tone: z4Done >= z4Plan * 0.8 ? "good" : "info", text: `Menit Z4: ${z4Done} dari ±${z4Plan} terencana.` });
      }
      if (q.failed) {
        tone = "warn";
        points.push({ tone: "warn", text: `Belum sesuai target: ${q.reasons.join("; ")}.` });
      } else if (q.easySuccess) {
        points.push({ tone: "good", text: "Sesi tuntas dengan HR terkontrol & RPE ≤7 — tanda adaptasi. Engine bisa menaikkan target bila ini konsisten." });
      } else if (!q.failed && log.reps.length) {
        points.push({ tone: "good", text: "Target sesi tercapai." });
      }
      if (q.ladderFailure || log.discomfort_at_hr.flag) {
        tone = "warn";
        points.push({ tone: "info", text: `HR ±170 terasa berat${log.discomfort_at_hr.bpm ? ` (mulai ${log.discomfort_at_hr.bpm})` : ""}. Itu normal di ambang laktat selama napas teratur dan pulih dalam 1–2 menit jog — yang dilatih justru toleransinya.` });
        [0, 1, 4].forEach((i) => cues.add(CUES_HR170[i]));
      }
      const firstRep = log.reps[0];
      const work = s.segments.find((g) => g.kind === "work");
      const wp = work ? resolvePace(work, snap.paceProfile, s.week) : null;
      if (firstRep?.pace_s && wp && firstRep.pace_s < wp[0] - 5) {
        points.push({ tone: "info", text: `Rep 1 terlalu cepat (${formatPace(firstRep.pace_s)} vs ${formatPace(wp[0])}–${formatPace(wp[1])}).` });
        cues.add(CUES_HR170[0]);
      }
      if (log.reps.some((r) => r.stop_reason === "hr_recovery_slow")) cues.add(CUES_HR170[5]);
      if (!cues.size) { cues.add(CUES_HR170[2]); cues.add(CUES_HR170[3]); }
      if (LADDER_TYPES.includes(s.type) && log.rpe >= 9) points.push({ tone: "warn", text: `RPE ${log.rpe}: terlalu dekat batas. Rep selesai sedikit lebih lambat lebih baik daripada berhenti.` });
    }
  }

  points.push(...splitAnalysis(log));
  if (log.avg_cadence != null && log.avg_cadence < 165) {
    points.push({ tone: "info", text: `Kadens ${log.avg_cadence} langkah/menit. Target 170–180: langkah pendek-cepat mengurangi beban sendi.` });
    cues.add(CUES_HR170[3]);
  }
  if (log.recovery_h != null && log.recovery_h > 48) {
    points.push({ tone: "info", text: `Huawei menyarankan pemulihan ${log.recovery_h} jam. Bila sesi berikutnya keras dan badan masih berat, isi check-in jujur — engine akan menyesuaikan.` });
  }

  const changes = engineChanges(state, log).map((c) =>
    `${c.mode === "pending" ? "Menunggu persetujuanmu" : c.mode === "blocked" ? "Ditahan guardrail" : "Diterapkan"}: ${c.title}`);
  const nextS = snap.sessions.find((x) => isActive(x) && x.date > log.date);
  const next = nextS ? `${SESSION_LABEL[nextS.type]} · ${formatDateId(nextS.date)}${nextS.is_hard ? " (keras)" : ""}` : null;
  if (points.some((p) => p.tone === "warn") && tone === "good") tone = "info";
  return { tone, headline, points, cues: [...cues].slice(0, 3), changes, next };
}
