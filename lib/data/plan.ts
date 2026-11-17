import "server-only";
import { cache } from "react";
import seed from "@/seed/plan.json";
import type { HrProfile, PaceProfile, PlanSeed, Session, Week } from "@/lib/engine/types";
import { createSupabaseServer, supabaseConfigured } from "@/lib/supabase/server";

export interface PlanView {
  source: "seed" | "supabase";
  planVersion: number;
  athlete: string;
  race: PlanSeed["meta"]["race"];
  programStart: string;
  weeks: Week[];
  sessions: Session[];
  paceProfile: PaceProfile;
  hrProfile: HrProfile;
  strengthTemplate: Record<string, string>;
  decisions: Record<string, string>;
}

function fromSeed(): PlanView {
  const p = seed as unknown as PlanSeed;
  return {
    source: "seed",
    planVersion: 1,
    athlete: p.meta.athlete,
    race: p.meta.race,
    programStart: p.meta.program_start,
    weeks: p.weeks,
    sessions: p.sessions,
    paceProfile: p.pace_profile,
    hrProfile: { version: 1, lthr: p.meta.lthr, source: "estimate" },
    strengthTemplate: p.strength_template,
    decisions: p.meta.decisions,
  };
}

async function fromSupabase(): Promise<PlanView> {
  const db = await createSupabaseServer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Row = Record<string, any>;
  const one = async (q: PromiseLike<{ data: unknown; error: unknown }>, what: string): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data, error } = await q;
    if (error || !data) throw new Error(`Gagal memuat ${what}: ${JSON.stringify(error)}`);
    return data;
  };
  const pv = await one(
    db.from("plan_versions").select("id, version, meta").eq("is_active", true).single(),
    "plan aktif",
  );
  const [athlete, pace, hr, weeks, sessions] = await Promise.all([
    one(db.from("athlete_profile").select("*").single(), "profil"),
    one(db.from("pace_profile").select("*").order("version", { ascending: false }).limit(1).single(), "pace profile"),
    one(db.from("hr_profile").select("*").order("version", { ascending: false }).limit(1).single(), "hr profile"),
    one(db.from("plan_weeks").select("*").eq("plan_version_id", pv.id).order("week"), "minggu"),
    one(db.from("sessions").select("*").eq("plan_version_id", pv.id).order("date"), "sesi"),
  ]);
  const meta = pv.meta as Row;
  return {
    source: "supabase",
    planVersion: pv.version,
    athlete: athlete.name,
    race: meta.race,
    programStart: (weeks as Row[])[0]?.start_date,
    weeks: (weeks as Row[]).map((w) => ({
      week: w.week, start: w.start_date, phase: w.phase, is_recovery_week: w.is_recovery_week,
      is_taper: w.is_taper, planned_km: Number(w.planned_km), color: w.color,
      guardrail_exception: w.guardrail_exception,
      hard_sessions: (sessions as Row[]).filter((s) => s.week === w.week && s.is_hard).map((s) => s.day),
    })),
    sessions: (sessions as Row[]).map((s) => ({
      id: s.key, date: s.date, week: s.week, day: s.day, phase: s.phase, type: s.type,
      is_hard: s.is_hard, planned_km: Number(s.planned_km), z4_target_min: s.z4_target_min,
      z4_planned_min: s.z4_planned_min, mp_hmp_km: null, segments_km: Number(s.planned_km),
      segments: s.segments, notes: s.notes ?? [], source_text: s.source_text ?? "",
    })),
    paceProfile: { version: pace.version, default: pace.codes, base_phase: pace.base_phase },
    hrProfile: { version: hr.version, lthr: hr.lthr, source: hr.source },
    strengthTemplate: athlete.gym_template ?? {},
    decisions: meta.decisions ?? {},
  };
}

export const getPlan = cache(async (): Promise<PlanView> =>
  supabaseConfigured() ? fromSupabase() : fromSeed(),
);

export function sessionByDate(plan: PlanView, date: string): Session | undefined {
  return plan.sessions.find((s) => s.date === date);
}

export function weekOf(plan: PlanView, date: string): Week | undefined {
  return [...plan.weeks].reverse().find((w) => w.start <= date);
}
