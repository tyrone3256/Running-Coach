// Skema input log & check-in (dipakai API route dan form). Validasi di server.
import { z } from "zod";

export { RED_FLAGS, STOP_REASONS, STOP_REASON_LABEL, type RedFlagId } from "./constants";
import { RED_FLAGS, STOP_REASONS, type RedFlagId } from "./constants";

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const repSchema = z.object({
  index: int(1, 50),
  distance_m: z.number().min(0).max(50_000).nullable().optional(),
  duration_s: z.number().min(0).max(36_000).nullable().optional(),
  pace_s: z.number().min(120).max(1200).nullable().optional(),
  avg_hr: int(40, 230).nullable().optional(),
  max_hr: int(40, 240).nullable().optional(),
  hr_drop_60s: z.number().min(-50).max(120).nullable().optional(),
  completed: z.boolean(),
  stop_reason: z.enum(STOP_REASONS).nullable().optional(),
  stop_at_s: z.number().min(0).max(36_000).nullable().optional(),
});
export type Rep = z.infer<typeof repSchema>;

export const zoneSecondsSchema = z.object({
  Z1: z.number().min(0), Z2: z.number().min(0), Z3: z.number().min(0),
  Z4: z.number().min(0), Z5: z.number().min(0),
});
export type ZoneSeconds = z.infer<typeof zoneSecondsSchema>;

/** Stream ringkas (resolusi ~5 dtk) untuk insights & cek sensor (R13). */
export const streamsSchema = z.object({
  t: z.array(z.number()),
  hr: z.array(z.number().nullable()),
  d: z.array(z.number().nullable()),
  cad: z.array(z.number().nullable()),
});
export type Streams = z.infer<typeof streamsSchema>;

export const workoutLogSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  session_key: z.string().regex(/^W\d{2}-(mon|tue|wed|thu|fri|sat|sun)$/).nullable(),
  distance_m: z.number().min(0).max(100_000),
  duration_s: z.number().int().min(60).max(36_000),
  avg_hr: int(40, 230).nullable(),
  max_hr: int(40, 240).nullable(),
  hr_source: z.enum(["chest", "wrist"]),
  avg_cadence: int(60, 260).nullable(),
  rpe: int(1, 10),
  reps: z.array(repSchema).max(50).default([]),
  time_in_zone: zoneSecondsSchema.nullable(),
  hr_drop_1min: z.number().min(-50).max(120).nullable(),
  discomfort_at_hr: z.object({ flag: z.boolean(), bpm: int(40, 230).nullable() }),
  rep_incomplete: z.boolean(),
  temp_c: z.number().min(-10).max(50).nullable(),
  humidity: z.number().min(0).max(100).nullable(),
  pain: z.object({
    score: int(0, 10),
    location: z.string().max(80).nullable(),
    sharp: z.boolean(),
  }),
  red_flags: z.array(z.enum(RED_FLAGS.map((f) => f.id) as [RedFlagId, ...RedFlagId[]])).default([]),
  notes: z.string().max(2000).nullable(),
  source: z.enum(["manual", "fit", "gpx", "tcx", "strava"]),
  external_id: z.string().max(200).nullable(),
  streams: streamsSchema.nullable(),
});
export type WorkoutLogInput = z.infer<typeof workoutLogSchema>;
export type WorkoutLog = WorkoutLogInput & {
  id: string;
  created_at: string;
  avg_pace_s: number | null;
  safety: SafetyResult;
  /** diisi engine (R13) */
  sensor_suspect?: boolean;
  sensor_suspect_reason?: string | null;
};

export const checkinSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  resting_hr: int(30, 120).nullable(),
  sleep_h: z.number().min(0).max(16).nullable(),
  soreness: int(1, 10).nullable(),
  pain_score: int(0, 10).nullable(),
  pain_location: z.string().max(80).nullable(),
  hrv: z.number().min(0).max(300).nullable(),
  temp_c: z.number().min(-10).max(50).nullable().optional(),
  humidity: z.number().min(0).max(100).nullable().optional(),
});
export type CheckinInput = z.infer<typeof checkinSchema>;

export interface SafetyResult {
  level: "ok" | "medical_check" | "stop";
  reasons: string[];
}
