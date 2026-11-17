// Pembentuk sesi/segmen untuk perubahan (murni).
import type { SessionPatch } from "./model";
import type { PaceProfile, Segment, Session } from "./types";
import { plannedZ4Minutes, resolvePace } from "./pace";

const round05 = (x: number) => Math.round(x * 2) / 2;

/** km perkiraan segmen; segmen berbasis durasi dihitung dari pace tengah. */
export function segmentKmEst(seg: Segment, profile: PaceProfile, week: number): number {
  const reps = seg.reps ?? 1;
  if (seg.distance_m) return (seg.distance_m * reps) / 1000;
  if (seg.duration_s) {
    const p = resolvePace(seg, profile, week);
    if (p) return (seg.duration_s * reps) / ((p[0] + p[1]) / 2);
  }
  return 0;
}

export function sessionKmEst(segments: Segment[], profile: PaceProfile, week: number): number {
  return round05(segments.reduce((a, s) => a + segmentKmEst(s, profile, week), 0));
}

/** Durasi satu rep kerja (menit). */
export function repMinutes(session: Session, profile: PaceProfile): number | null {
  const w = session.segments.find((s) => s.kind === "work");
  if (!w) return null;
  if (w.duration_s) return w.duration_s / 60;
  const p = resolvePace(w, profile, session.week);
  if (!p || !w.distance_m) return null;
  return ((w.distance_m / 1000) * (p[0] + p[1])) / 2 / 60;
}

export function easyPatch(session: Session, note: string): SessionPatch {
  return {
    type: "easy",
    is_hard: false,
    z4_target_min: null,
    segments: [{ kind: "steady", intensity: "E", hr_zone: "Z2", distance_m: Math.round(session.planned_km * 1000) }],
    notes: [...session.notes, note],
  };
}

/** R12: pecah kerja jadi rep lebih pendek (rec 1′ jog), total menit Z4 = totalMin. */
export function splitTempoPatch(
  next: Session, totalMin: number, repMin: number, profile: PaceProfile, note: string,
): SessionPatch {
  const w = next.segments.find((s) => s.kind === "work")!;
  const reps = Math.max(2, Math.round(totalMin / repMin));
  // durasi rep diatur supaya total menit Z4 tepat = totalMin
  const work: Segment = {
    kind: "work", intensity: w.intensity, hr_zone: "Z4", reps, duration_s: Math.round((totalMin * 60) / reps),
    ...(w.pace_variant ? { pace_variant: w.pace_variant } : {}),
    label: "Pecahan R12",
  };
  const rec: Segment = {
    kind: "recovery", intensity: "TJOG", hr_zone: "Z1", reps: reps - 1, duration_s: 60, between_reps: true,
  };
  const wu = next.segments.filter((s) => s.kind === "warmup");
  const cd = next.segments.filter((s) => s.kind === "cooldown");
  const segments = [...wu, work, rec, ...cd];
  return {
    segments,
    planned_km: sessionKmEst(segments, profile, next.week),
    z4_target_min: totalMin,
    notes: [...next.notes, note],
  };
}

/** R3: volume kerja −20% (rep dikurangi atau jarak/durasi dipotong). */
export function cutWorkPatch(s: Session, profile: PaceProfile, factor: number, note: string): SessionPatch {
  const segments = s.segments.map((g) => ({ ...g }));
  const wi = segments.findIndex((g) => g.kind === "work");
  if (wi < 0) return { planned_km: round05(s.planned_km * factor), notes: [...s.notes, note] };
  const w = segments[wi];
  const before = segmentKmEst(w, profile, s.week);
  if ((w.reps ?? 1) > 1) {
    w.reps = Math.max(1, Math.round((w.reps ?? 1) * factor));
    const ri = segments.findIndex((g) => g.kind === "recovery" && g.between_reps);
    if (ri >= 0) segments[ri].reps = Math.max(0, w.reps - 1);
  } else if (w.distance_m) {
    w.distance_m = Math.max(500, Math.round((w.distance_m * factor) / 500) * 500);
  } else if (w.duration_s) {
    w.duration_s = Math.max(300, Math.round((w.duration_s * factor) / 60) * 60);
  }
  const removed = before - segmentKmEst(w, profile, s.week);
  return {
    segments: segments.filter((g) => g.kind !== "recovery" || (g.reps ?? 1) > 0),
    planned_km: round05(Math.max(0, s.planned_km - removed)),
    notes: [...s.notes, note],
  };
}

/** Skala volume sesi non-kualitas (segmen jarak ikut diskalakan). */
export function scaleEasyPatch(s: Session, factor: number, note: string): SessionPatch {
  return {
    planned_km: round05(s.planned_km * factor),
    segments: s.segments.map((g) => (g.distance_m && g.kind !== "strides" && g.kind !== "hill"
      ? { ...g, distance_m: Math.round((g.distance_m * factor) / 100) * 100 } : g)),
    notes: [...s.notes, note],
  };
}

export { plannedZ4Minutes };
