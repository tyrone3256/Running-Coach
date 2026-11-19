// Analisis: kebugaran sekarang (dari PB / pace easy / kalibrasi program) vs target race.
// Semua angka adalah perkiraan model Daniels; ditampilkan apa adanya, tidak dipaksakan.
import { RACE_DISTANCE_M, RACE_LABEL, type RaceDistance } from "@/lib/engine/types";
import { predictTime, vdotAnchors, vdotFromRace } from "@/lib/engine/vdot";
import { daysBetween } from "@/lib/dates";
import { DISTANCE_ORDER, type PlanningProfile } from "./profile";
import { formatRaceTime } from "./time";

export interface FitnessEstimate {
  vdot: number;
  source: "pb" | "easy_pace" | "program";
  detail: string;
  /** VDOT tiap PB (setelah koreksi umur PB) */
  pbVdots: Array<{ distance: RaceDistance; vdot: number; raw: number; ageMonths: number | null }>;
  warnings: string[];
}

/** Selisih kalibrasi program terhadap Daniels: E program ±15 dtk/km lebih lambat (panas BSD & prioritas HR). */
const EASY_OFFSET_S = 15;

function vdotFromEasyPace(easy_s: number): number {
  let lo = 20, hi = 85;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (vdotAnchors(mid).E > easy_s - EASY_OFFSET_S) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
/** angka desimal format Indonesia (koma) */
const n = (x: number) => x.toLocaleString("id-ID", { maximumFractionDigits: 1 });

export function estimateFitness(p: PlanningProfile, programVdot: number, today: string): FitnessEstimate {
  const warnings: string[] = [];
  const pbVdots = DISTANCE_ORDER.flatMap((d) => {
    const pb = p.pbs[d];
    if (!pb) return [];
    const raw = vdotFromRace(RACE_DISTANCE_M[d], pb.time_s);
    const ageMonths = pb.date ? Math.max(0, daysBetween(pb.date, today) / 30.4) : null;
    // PB lama tidak mencerminkan kebugaran sekarang: −1 VDOT per 12 bulan setelah 12 bulan pertama (maks −4)
    const penalty = ageMonths != null && ageMonths > 12 ? Math.min(4, (ageMonths - 12) / 12) : 0;
    if (penalty > 0) warnings.push(`PB ${RACE_LABEL[d]} berumur ±${Math.round(ageMonths!)} bulan → dikurangi ${n(round1(penalty))} VDOT.`);
    return [{ distance: d, vdot: round1(raw - penalty), raw: round1(raw), ageMonths: ageMonths == null ? null : Math.round(ageMonths) }];
  });

  if (pbVdots.length) {
    const best = pbVdots.reduce((a, b) => (b.vdot > a.vdot ? b : a));
    // PB jarak jauh lebih relevan untuk kebugaran aerobik; bila PB pendek jauh lebih tinggi, pakai rata-rata
    const others = pbVdots.filter((x) => x !== best);
    let vdot = best.vdot;
    if (others.length && best.vdot - Math.max(...others.map((x) => x.vdot)) > 3) {
      vdot = round1((best.vdot + Math.max(...others.map((x) => x.vdot))) / 2);
      warnings.push(`PB ${RACE_LABEL[best.distance]} jauh lebih kuat dari PB lain — dipakai rata-rata (${n(vdot)}) supaya pace tidak terlalu cepat.`);
    }
    if (p.easy_pace_s) {
      const ev = vdotFromEasyPace(p.easy_pace_s);
      if (ev < vdot - 5) warnings.push(`Pace easy kamu (${fmtPace(p.easy_pace_s)}) jauh lebih lambat dari level PB — bagus untuk HR, tapi bisa juga tanda PB sudah tidak mewakili kondisi sekarang.`);
    }
    return { vdot, source: "pb", detail: `dari PB ${RACE_LABEL[best.distance]} ${formatRaceTime(p.pbs[best.distance]!.time_s)}`, pbVdots, warnings };
  }
  if (p.easy_pace_s) {
    const vdot = round1(vdotFromEasyPace(p.easy_pace_s));
    warnings.push("Tanpa PB, kebugaran diperkirakan dari pace easy — kasar. Tes 30′ atau time trial 5K/10K akan memperbaikinya.");
    return { vdot, source: "easy_pace", detail: `dari pace easy ${fmtPace(p.easy_pace_s)}/km`, pbVdots, warnings };
  }
  warnings.push("Belum ada PB atau pace easy — dipakai kalibrasi program sekarang.");
  return { vdot: round1(programVdot), source: "program", detail: "kalibrasi program saat ini", pbVdots, warnings };
}

export interface GoalAnalysis {
  goalVdot: number;
  fitnessVdot: number;
  gap: number;
  weeks: number;
  /** perkiraan kenaikan VDOT yang masuk akal sampai race */
  feasibleGain: number;
  rating: "dalam_jangkauan" | "realistis" | "ambisius" | "sangat_ambisius";
  predicted_s: number;
  /** waktu yang masuk akal dengan kenaikan feasibleGain */
  realistic_s: number;
  goalPace_s: number;
  message: string;
}

/** ±0,2 VDOT/minggu latihan konsisten: konservatif untuk pelari rekreasi terlatih (perkiraan kasar). */
export const VDOT_GAIN_PER_WEEK = 0.2;

export function analyzeGoal(fitnessVdot: number, distance: RaceDistance, goal_time_s: number, startDate: string, raceDate: string): GoalAnalysis {
  const dist = RACE_DISTANCE_M[distance];
  const goalVdot = round1(vdotFromRace(dist, goal_time_s));
  const weeks = Math.max(0, Math.floor(daysBetween(startDate, raceDate) / 7));
  const feasibleGain = round1(Math.min(6, weeks * VDOT_GAIN_PER_WEEK));
  const gap = round1(goalVdot - fitnessVdot);
  const rating: GoalAnalysis["rating"] = gap <= 0 ? "dalam_jangkauan" : gap <= feasibleGain ? "realistis" : gap <= feasibleGain * 1.75 ? "ambisius" : "sangat_ambisius";
  const predicted_s = predictTime(fitnessVdot, dist);
  const realistic_s = predictTime(fitnessVdot + feasibleGain, dist);
  const label = RACE_LABEL[distance];
  const msg: Record<GoalAnalysis["rating"], string> = {
    dalam_jangkauan: `Kebugaran sekarang sudah setara ${label} ${formatRaceTime(predicted_s)} — target ${formatRaceTime(goal_time_s)} dalam jangkauan. Fokus: daya tahan & eksekusi pacing.`,
    realistis: `Perlu naik ±${n(gap)} VDOT dalam ${weeks} minggu (perkiraan wajar ±${n(feasibleGain)}). Realistis dengan latihan konsisten.`,
    ambisius: `Perlu naik ±${n(gap)} VDOT, sementara perkiraan wajar ±${n(feasibleGain)} dalam ${weeks} minggu. Ambisius — mungkin, tapi siapkan target cadangan ±${formatRaceTime(realistic_s)}.`,
    sangat_ambisius: `Perlu naik ±${n(gap)} VDOT dalam ${weeks} minggu (wajar ±${n(feasibleGain)}). Sangat ambisius & risiko cedera naik bila dipaksakan. Target yang lebih masuk akal: ±${formatRaceTime(realistic_s)}.`,
  };
  return {
    goalVdot, fitnessVdot, gap, weeks, feasibleGain, rating, predicted_s, realistic_s,
    goalPace_s: Math.round(goal_time_s / (dist / 1000)), message: msg[rating],
  };
}

export function predictionsFor(vdot: number) {
  return DISTANCE_ORDER.map((d) => ({ distance: d, time_s: predictTime(vdot, RACE_DISTANCE_M[d]) }));
}

function fmtPace(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}
