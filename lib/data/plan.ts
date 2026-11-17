import "server-only";
import { cache } from "react";
import seed from "@/seed/plan.json";
import type { HrProfile, PaceProfile, PlanSeed, Session, Week } from "@/lib/engine/types";
import { getPlanStore, seedSnapshot } from "@/lib/data/plan-store";
import { supabaseConfigured } from "@/lib/supabase/server";
import { isActive } from "@/lib/engine/snapshot";

export interface PlanView {
  source: "seed" | "local" | "supabase";
  planVersion: number;
  athlete: string;
  race: PlanSeed["meta"]["race"];
  programStart: string;
  weeks: Week[];
  /** semua sesi termasuk yang di-rest/skip (cek isActive) */
  sessions: Session[];
  paceProfile: PaceProfile;
  hrProfile: HrProfile;
  strengthTemplate: Record<string, string>;
  decisions: Record<string, string>;
}

export const getPlan = cache(async (): Promise<PlanView> => {
  const p = seed as unknown as PlanSeed;
  let snap = seedSnapshot();
  let source: PlanView["source"] = "seed";
  try {
    snap = await getPlanStore().getActive();
    source = supabaseConfigured() ? "supabase" : "local";
  } catch {
    // produksi tanpa Supabase: tampilkan seed read-only
  }
  return {
    source,
    planVersion: snap.version,
    athlete: p.meta.athlete,
    race: p.meta.race,
    programStart: p.meta.program_start,
    weeks: snap.weeks,
    sessions: snap.sessions,
    paceProfile: snap.paceProfile,
    hrProfile: { version: 1, lthr: snap.lthr, source: snap.lthrSource },
    strengthTemplate: p.strength_template,
    decisions: p.meta.decisions,
  };
});

export function sessionByDate(plan: PlanView, date: string): Session | undefined {
  return plan.sessions.find((s) => s.date === date && isActive(s));
}

export function weekOf(plan: PlanView, date: string): Week | undefined {
  return [...plan.weeks].reverse().find((w) => w.start <= date);
}
