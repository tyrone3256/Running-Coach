// Profil perencanaan dari tab Target: race berikutnya, performa sekarang, kendala.
import { z } from "zod";
import { DAY_KEYS, type DayKey, type RaceDistance } from "@/lib/engine/types";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sec = (min: number, max: number) => z.number().int().min(min).max(max);

const pb = (min: number, max: number) => z.object({ time_s: sec(min, max), date: iso.nullable().default(null) }).nullable().default(null);

export const planningProfileSchema = z.object({
  pbs: z.object({
    "5k": pb(12 * 60, 60 * 60),
    "10k": pb(26 * 60, 2 * 3600),
    hm: pb(58 * 60, 4 * 3600),
    fm: pb(2 * 3600, 8 * 3600),
  }),
  /** pace easy yang biasa dijalani (detik/km) */
  easy_pace_s: sec(240, 600).nullable().default(null),
  /** km/minggu rata-rata 4 minggu terakhir (kosong = dihitung dari log) */
  weekly_km: z.number().min(0).max(250).nullable().default(null),
  longest_run_km: z.number().min(0).max(60).nullable().default(null),
  run_days: z.array(z.enum(DAY_KEYS as [DayKey, ...DayKey[]])).min(3).max(7).default(["tue", "wed", "thu", "sat", "sun"]),
  long_day: z.enum(DAY_KEYS as [DayKey, ...DayKey[]]).default("sat"),
  constraints: z.object({
    hr170: z.boolean().default(true),
    heat: z.boolean().default(true),
    injury: z.string().max(200).nullable().default(null),
    notes: z.string().max(1000).nullable().default(null),
  }),
  next_race: z.object({
    name: z.string().min(1).max(80),
    distance: z.enum(["5k", "10k", "hm", "fm"]),
    date: iso,
    goal_time_s: sec(12 * 60, 8 * 3600),
  }).nullable().default(null),
}).refine((p) => p.run_days.includes(p.long_day), { message: "Hari long run harus termasuk hari lari", path: ["long_day"] });

export type PlanningProfile = z.infer<typeof planningProfileSchema>;
export type PlanningInput = z.input<typeof planningProfileSchema>;

export const EMPTY_PROFILE: PlanningProfile = planningProfileSchema.parse({
  pbs: {}, constraints: {},
});

export const DISTANCE_ORDER: RaceDistance[] = ["5k", "10k", "hm", "fm"];
