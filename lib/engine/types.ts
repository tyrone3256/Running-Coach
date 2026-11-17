// Tipe domain — dipakai engine (murni), data layer, dan UI.

export const INTENSITY_CODES = [
  "WU", "E", "REC", "L", "M", "H", "T", "N", "JOG", "TJOG", "S", "HILL", "TEST",
] as const;
export type Intensity = (typeof INTENSITY_CODES)[number];

/** Kode yang punya pace di pace profile. HILL & TEST = effort-based. */
export type PacedCode = Exclude<Intensity, "HILL" | "TEST">;

export type ZoneName = "Z1" | "Z2" | "Z3" | "Z4" | "Z5";
/** "Z4" atau rentang "Z1-2", "Z3-4", "Z4-5" */
export type HrZoneTag = string;

export type SegmentKind =
  | "warmup" | "work" | "recovery" | "steady" | "cooldown" | "strides" | "hill" | "test";

export interface Segment {
  kind: SegmentKind;
  intensity: Intensity;
  reps?: number;
  distance_m?: number | null;
  duration_s?: number;
  hr_zone: HrZoneTag | null;
  pace_variant?: "base";
  /** offset detik/km relatif dari kode: [untuk batas cepat, untuk batas lambat] */
  pace_adj_s?: [number, number];
  z4_target_min?: number;
  label?: string;
  note?: string;
  between_reps?: boolean;
  fill_remaining?: boolean;
  distance_is_estimate?: boolean;
  position?: "last";
  test_type?: "30min" | "10k_tt";
  target_note?: string;
  effort?: string;
  recovery?: string;
  /** jejak teks Excel, hanya untuk audit */
  src_pace?: string | null;
}

export type DayKey = "tue" | "wed" | "thu" | "sat" | "sun";

export type SessionType =
  | "easy" | "easy_strides" | "easy_hill" | "recovery" | "vo2_4x4" | "tempo" | "hm_pace"
  | "fartlek" | "test_30min" | "tt_10k" | "long" | "long_with_pace" | "long_progressive"
  | "long_race_sim" | "shakeout" | "race";

export type Phase = "Transisi" | "Base" | "Build" | "Spesifik" | "Peak" | "Taper";

export interface Session {
  id: string;
  date: string; // YYYY-MM-DD
  week: number;
  day: DayKey;
  phase: Phase;
  type: SessionType;
  is_hard: boolean;
  planned_km: number;
  z4_target_min: number | null;
  z4_planned_min: number | null;
  mp_hmp_km: number | null;
  segments_km: number;
  segments: Segment[];
  notes: string[];
  source_text: string;
}

export interface Week {
  week: number;
  start: string;
  phase: Phase;
  is_recovery_week: boolean;
  is_taper: boolean;
  planned_km: number;
  hard_sessions: DayKey[];
  color: { header: string; cell: string };
  guardrail_exception: null | { rule: string; status: string; decision_ref: string };
}

export type PaceRange = [number, number]; // detik/km [cepat, lambat]

export interface PaceProfile {
  version: number;
  default: Record<PacedCode, PaceRange>;
  base_phase: { weeks: [number, number] } & Partial<Record<PacedCode, PaceRange>>;
}

export interface HrProfile {
  version: number;
  lthr: number;
  source: "estimate" | "test";
}

export interface PlanSeed {
  meta: {
    source: string;
    athlete: string;
    race: { name: string; date: string; distance_m: number; goal_time_s: number; goal_pace_s: number };
    program_start: string;
    weeks: number;
    lthr: number;
    decisions: Record<string, string>;
  };
  pace_profile: PaceProfile;
  hr_zones_pct_lthr: Record<ZoneName, [number, number]>;
  z4_ladder: Array<{ weeks: [number, number]; min?: number; hmp_block_km?: [number, number] }>;
  recovery_weeks: number[];
  vo2_weeks_w15_w24: number[];
  weeks: Week[];
  sessions: Session[];
  strength_template: Record<string, string>;
}
