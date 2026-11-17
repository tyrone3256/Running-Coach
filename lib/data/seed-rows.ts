// Transformasi murni plan.json → baris tabel Supabase (dipakai seed script, dites di Vitest).
import type { PlanSeed } from "@/lib/engine/types";

export interface SeedRows {
  athlete_profile: Record<string, unknown>;
  pace_profile: Record<string, unknown>;
  hr_profile: Record<string, unknown>;
  plan_version: Record<string, unknown>;
  plan_weeks: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
}

export function planToRows(plan: PlanSeed, userId: string, planVersionId: string): SeedRows {
  const { meta } = plan;
  const { weeks: baseWeeks, ...baseCodes } = plan.pace_profile.base_phase;
  return {
    athlete_profile: {
      user_id: userId,
      name: meta.athlete,
      base: "BSD (datar, panas & lembap)",
      race_name: meta.race.name,
      race_date: meta.race.date,
      race_distance_m: meta.race.distance_m,
      goal_time_s: meta.race.goal_time_s,
      goal_pace_s: meta.race.goal_pace_s,
      gym_template: plan.strength_template,
      hr_source_default: "wrist",
      watch_model: "Huawei",
      data_source: "huawei_health_via_strava",
    },
    pace_profile: {
      user_id: userId,
      version: plan.pace_profile.version,
      valid_from: meta.program_start,
      codes: plan.pace_profile.default,
      // vdot_ref = VDOT target program (HM 1:45), acuan kalibrasi R5
      base_phase: { weeks: baseWeeks, ...baseCodes, vdot_ref: 42.6 },
      source: "seed",
    },
    hr_profile: {
      user_id: userId,
      version: 1,
      valid_from: meta.program_start,
      lthr: meta.lthr,
      source: "estimate",
    },
    plan_version: {
      id: planVersionId,
      user_id: userId,
      version: 1,
      parent_version: null,
      reason: `Seed dari ${meta.source}`,
      is_active: true,
      meta: {
        decisions: meta.decisions,
        z4_ladder: plan.z4_ladder,
        recovery_weeks: plan.recovery_weeks,
        vo2_weeks_w15_w24: plan.vo2_weeks_w15_w24,
        race: meta.race,
      },
    },
    plan_weeks: plan.weeks.map((w) => ({
      user_id: userId,
      plan_version_id: planVersionId,
      week: w.week,
      start_date: w.start,
      phase: w.phase,
      is_recovery_week: w.is_recovery_week,
      is_taper: w.is_taper,
      planned_km: w.planned_km,
      color: w.color,
      guardrail_exception: w.guardrail_exception,
    })),
    sessions: plan.sessions.map((s) => ({
      user_id: userId,
      plan_version_id: planVersionId,
      key: s.id,
      date: s.date,
      week: s.week,
      day: s.day,
      phase: s.phase,
      type: s.type,
      segments: s.segments,
      planned_km: s.planned_km,
      is_hard: s.is_hard,
      z4_target_min: s.z4_target_min,
      z4_planned_min: s.z4_planned_min,
      notes: s.notes,
      source_text: s.source_text,
    })),
  };
}
