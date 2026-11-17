// VDOT Daniels–Gilbert + turunan pace latihan.
import type { PacedCode, PaceProfile, PaceRange } from "./types";

/** VO2 (ml/kg/min) pada kecepatan v (m/menit). */
export function vo2AtVelocity(v: number): number {
  return -4.6 + 0.182258 * v + 0.000104 * v * v;
}

/** Fraksi VO2max yang bisa dipertahankan selama t menit. */
export function fractionForDuration(tMin: number): number {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
}

export function vdotFromRace(distance_m: number, duration_s: number): number {
  const t = duration_s / 60;
  return vo2AtVelocity(distance_m / t) / fractionForDuration(t);
}

/** Kecepatan (m/menit) pada fraksi f × VDOT. */
export function velocityAtFraction(vdot: number, f: number): number {
  const c = 4.6 + f * vdot;
  return (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * c)) / (2 * 0.000104);
}

export const paceFromVelocity = (v: number) => 60000 / v; // detik/km

/** Prediksi waktu (detik) untuk jarak tertentu pada VDOT tertentu (bisection). */
export function predictTime(vdot: number, distance_m: number): number {
  let lo = 60;
  let hi = 60 * 60 * 8;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (vdotFromRace(distance_m, mid) > vdot) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const r = (x: number) => Math.round(x);

/** Anchor pace (detik/km, tengah) per kode untuk VDOT tertentu (rumus Daniels). */
export function vdotAnchors(vdot: number) {
  const mid = (a: number, b: number) => (paceFromVelocity(velocityAtFraction(vdot, a)) + paceFromVelocity(velocityAtFraction(vdot, b))) / 2;
  return {
    H: predictTime(vdot, 21097.5) / 21.0975,
    M: predictTime(vdot, 42195) / 42.195,
    T: mid(0.88, 0.86),
    N: predictTime(vdot, 5000) / 5,
    E: mid(0.74, 0.65),
  };
}

/**
 * Pace profile baru dari hasil tes (R5), RELATIF terhadap VDOT acuan program.
 * Program ditulis untuk VDOT target (HM 1:45 ≈ 42,6) dengan kalibrasi coach (mis. E lebih
 * lambat karena panas BSD & prioritas HR). Maka tiap zona digeser sebesar
 * (anchor VDOT baru − anchor VDOT acuan), bukan ditimpa angka Daniels mentah.
 * E juga menggeser L/REC/WU; base_phase T/N ikut bergeser sama dengan default.
 */
export function paceProfileFromVdot(vdot: number, current: PaceProfile, refVdot: number): {
  default: Partial<Record<PacedCode, PaceRange>>;
  base_phase: Partial<Record<PacedCode, PaceRange>>;
  shifts: Partial<Record<PacedCode, number>>;
  predictions: { hm_s: number; marathon_s: number; tenk_s: number; fivek_s: number };
} {
  const a = vdotAnchors(vdot);
  const b = vdotAnchors(refVdot);
  const shifts: Partial<Record<PacedCode, number>> = {
    H: r(a.H - b.H), M: r(a.M - b.M), T: r(a.T - b.T), N: r(a.N - b.N), E: r(a.E - b.E),
  };
  shifts.L = shifts.E;
  shifts.REC = shifts.E;
  shifts.WU = shifts.E;
  const def: Partial<Record<PacedCode, PaceRange>> = {};
  const base: Partial<Record<PacedCode, PaceRange>> = {};
  for (const [c, d] of Object.entries(shifts) as Array<[PacedCode, number]>) {
    def[c] = [current.default[c][0] + d, current.default[c][1] + d];
    const bp = current.base_phase[c];
    if (bp) base[c] = [bp[0] + d, bp[1] + d];
  }
  return {
    default: def,
    base_phase: base,
    shifts,
    predictions: {
      hm_s: predictTime(vdot, 21097.5), marathon_s: predictTime(vdot, 42195),
      tenk_s: predictTime(vdot, 10000), fivek_s: predictTime(vdot, 5000),
    },
  };
}
