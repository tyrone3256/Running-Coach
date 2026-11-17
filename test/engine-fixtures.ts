import seed from "@/seed/plan.json";
import type { PlanSeed } from "@/lib/engine/types";
import type { Checkin, EngineState, PlanChangeRecord, PlanSnapshot } from "@/lib/engine/model";
import { workoutLogSchema, type WorkoutLog, type WorkoutLogInput } from "@/lib/log/schema";
import { enrich } from "@/lib/data/store";

const plan = seed as unknown as PlanSeed;

export function baseSnapshot(): PlanSnapshot {
  return structuredClone({
    version: 1,
    weeks: plan.weeks,
    sessions: plan.sessions,
    paceProfile: { ...plan.pace_profile, vdot_ref: 42.6 },
    lthr: 170,
    lthrSource: "estimate" as const,
  });
}

let n = 0;
export function mkLog(p: Partial<WorkoutLogInput> & { date: string }, createdAt?: string): WorkoutLog {
  n++;
  const input = workoutLogSchema.parse({
    session_key: null, distance_m: 8000, duration_s: 2880, avg_hr: 145, max_hr: 155, hr_source: "chest",
    avg_cadence: 172, rpe: 3, reps: [], time_in_zone: null, hr_drop_1min: null,
    discomfort_at_hr: { flag: false, bpm: null }, rep_incomplete: false, temp_c: 27, humidity: 75,
    pain: { score: 0, location: null, sharp: false }, red_flags: [], notes: null, source: "manual",
    external_id: null, streams: null, ...p,
  });
  return enrich(input, `log-${n}`, createdAt ?? `${p.date}T00:00:${String(n % 60).padStart(2, "0")}.000Z`);
}

export function mkCheckin(p: Partial<Checkin> & { date: string }): Checkin {
  return { resting_hr: 52, sleep_h: 7.5, soreness: 3, pain_score: 0, pain_location: null, hrv: null, ...p };
}

export function mkState(p: Partial<EngineState> & { today: string }): EngineState {
  return { snapshot: baseSnapshot(), logs: [], checkins: [], changes: [], clearances: [], ...p };
}

export function appliedChange(p: Partial<PlanChangeRecord> & Pick<PlanChangeRecord, "rule" | "changes" | "date">): PlanChangeRecord {
  return {
    id: `chg-${++n}`, key: `k-${n}`, size: "small", title: "", reason: "", inverse: null, diff: [], mode: "auto",
    from_version: 1, to_version: 2, reverted_by: null, reverts: null, created_at: `${p.date}T00:00:00Z`, ...p,
  };
}

export const session = (snap: PlanSnapshot, id: string) => snap.sessions.find((s) => s.id === id)!;
