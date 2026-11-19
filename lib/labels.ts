import type { Intensity, Phase, SegmentKind, SessionType } from "@/lib/engine/types";

export const SESSION_LABEL: Record<SessionType, string> = {
  easy: "Easy run",
  easy_strides: "Easy + strides",
  easy_hill: "Easy + hill sprint",
  recovery: "Recovery run",
  vo2_4x4: "Norwegian 4×4 (VO2max)",
  tempo: "Tempo / threshold",
  hm_pace: "HM pace",
  fartlek: "Fartlek",
  test_30min: "Tes 30 menit (LTHR)",
  tt_10k: "10K time trial",
  long: "Long run",
  long_with_pace: "Long run + blok pace",
  long_progressive: "Long run progresif",
  long_race_sim: "Simulasi race",
  shakeout: "Shake-out (H-1)",
  race_pace: "Pace race",
  race: "🏆 RACE DAY",
};

export const KIND_LABEL: Record<SegmentKind, string> = {
  warmup: "WU",
  cooldown: "CD",
  work: "Kerja",
  recovery: "Rec",
  steady: "Lari",
  strides: "Strides",
  hill: "Hill",
  test: "Tes",
};

export const INTENSITY_LABEL: Record<Intensity, string> = {
  WU: "WU/CD", E: "Easy", REC: "Recovery", L: "Long", M: "Marathon pace", H: "HM pace",
  T: "Tempo", N: "4×4 / VO2", JOG: "Jog rec 4×4", TJOG: "Jog rec tempo", S: "Strides", RP: "Pace race",
  HILL: "Hill sprint", TEST: "Tes",
};

/** Warna fase dari Excel (header = aksen kuat, cell = latar pastel). */
export const PHASE_COLOR: Record<Phase, { header: string; cell: string }> = {
  Transisi: { header: "#7F7F7F", cell: "#EDEDED" },
  Base: { header: "#82B366", cell: "#D5E8D4" },
  Build: { header: "#6C8EBF", cell: "#DAE8FC" },
  Spesifik: { header: "#D6B656", cell: "#FFE6CC" },
  Peak: { header: "#B85450", cell: "#F8CECC" },
  Taper: { header: "#9673A6", cell: "#E1D5E7" },
};

export const GYM_LABEL: Record<string, string> = {
  mon: "Upper – Shoulder + core",
  tue: "Squat + Quads (SORE)",
  thu: "Deadlift + Ham/Glute (SORE)",
  fri: "Upper – Chest",
};
