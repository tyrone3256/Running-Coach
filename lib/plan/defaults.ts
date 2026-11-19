// Default untuk snapshot lama/seed: race HM dari Excel + kode pace RP. Murni (tanpa I/O).
import seed from "@/seed/plan.json";
import type { PaceProfile, PlanSeed, RaceTarget } from "@/lib/engine/types";
import type { PlanSnapshot } from "@/lib/engine/model";

const plan = seed as unknown as PlanSeed;

export function seedRace(): RaceTarget {
  const m = plan.meta;
  return {
    id: "race-1",
    name: m.race.name,
    distance: "hm",
    distance_m: m.race.distance_m,
    date: m.race.date,
    goal_time_s: m.race.goal_time_s,
    first_week: 1,
    last_week: plan.weeks.length,
    pace_code: "H",
    result_time_s: null,
  };
}

/** RP (pace race program berikutnya) belum ada di seed Excel → default = H. */
export function withRp(p: PaceProfile): PaceProfile {
  if (p.default.RP) return p;
  return { ...p, default: { ...p.default, RP: p.default.H } };
}

/** Lengkapi snapshot yang dibuat sebelum M8 (tanpa races / RP). */
export function normalizeSnapshot(s: PlanSnapshot): PlanSnapshot {
  return {
    ...s,
    races: s.races?.length ? s.races : [seedRace()],
    paceProfile: withRp(s.paceProfile),
  };
}

/** Race aktif: race pertama yang belum lewat; bila semua lewat → race terakhir. */
export function activeRace(s: Pick<PlanSnapshot, "races">, today: string): RaceTarget {
  const sorted = s.races.slice().sort((a, b) => a.date.localeCompare(b.date));
  return sorted.find((r) => r.date >= today) ?? sorted[sorted.length - 1];
}
