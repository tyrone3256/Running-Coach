// Aktivitas hasil import → draft log (belum disimpan; user konfirmasi di form).
import type { PaceProfile, Session } from "@/lib/engine/types";
import { resolvePace } from "@/lib/engine/pace";
import { todayIso } from "@/lib/dates";
import { detectReps, repMetrics, summarize, type ParsedActivity } from "./activity";
import type { Rep, WorkoutLogInput } from "./schema";

export interface ImportDraft {
  log: Omit<WorkoutLogInput, "rpe"> & { rpe: number | null };
  reps_detected: number;
  reps_expected: number;
  warnings: string[];
  device: string | null;
}

/** Ambang pace pemisah rep vs recovery untuk sesi kualitas; null bila sesi tanpa rep. */
export function repThreshold(session: Session, profile: PaceProfile) {
  const work = session.segments.find((s) => s.kind === "work");
  if (!work) return null;
  const wp = resolvePace(work, profile, session.week);
  if (!wp) return null;
  const rec = session.segments.find((s) => s.kind === "recovery")
    ?? session.segments.find((s) => s.kind === "warmup");
  const rp = rec ? resolvePace(rec, profile, session.week) : null;
  const slowWork = wp[1];
  const fastRec = rp ? rp[0] : slowWork + 60;
  return {
    thresholdPace_s: (slowWork + fastRec) / 2,
    expected: work.reps ?? 1,
    repDistance_m: work.distance_m ?? null,
    repDuration_s: work.duration_s ?? null,
  };
}

export function buildDraft(
  act: ParsedActivity,
  opts: { lthr: number; profile: PaceProfile; sessions: Session[]; fileName: string; hrSource: "chest" | "wrist" },
): ImportDraft {
  const sum = summarize(act, opts.lthr);
  const date = todayIso(new Date(act.start));
  const session = opts.sessions.find((s) => s.date === date) ?? null;
  let reps: Rep[] = [];
  let expected = 0;
  const warnings = [...act.warnings];
  const thr = session ? repThreshold(session, opts.profile) : null;
  if (thr) {
    expected = thr.expected;
    const segs = detectReps(act.samples, thr);
    reps = repMetrics(act.samples, segs, { distance_m: thr.repDistance_m, duration_s: thr.repDuration_s });
    if (segs.length !== thr.expected) {
      warnings.push(`Terdeteksi ${segs.length} rep dari ${thr.expected} yang direncanakan — cek & koreksi di bawah.`);
    }
  }
  const drops = reps.map((r) => r.hr_drop_60s).filter((x): x is number => x != null);
  return {
    log: {
      date,
      session_key: session?.id ?? null,
      distance_m: sum.distance_m,
      duration_s: sum.duration_s,
      avg_hr: sum.avg_hr,
      max_hr: sum.max_hr,
      hr_source: opts.hrSource,
      avg_cadence: sum.avg_cadence,
      rpe: null,
      reps,
      time_in_zone: sum.time_in_zone,
      hr_drop_1min: drops.length ? Math.round(drops.reduce((a, b) => a + b, 0) / drops.length) : null,
      discomfort_at_hr: { flag: false, bpm: null },
      rep_incomplete: reps.some((r) => !r.completed) || (expected > 0 && reps.length < expected),
      temp_c: null,
      humidity: null,
      pain: { score: 0, location: null, sharp: false },
      red_flags: [],
      notes: null,
      source: act.format,
      external_id: act.external_id ?? `${act.format}:${act.start}:${Math.round(sum.distance_m)}`,
      streams: sum.streams,
    },
    reps_detected: reps.length,
    reps_expected: expected,
    warnings,
    device: act.device,
  };
}
