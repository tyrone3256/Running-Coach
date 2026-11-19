// Generator program untuk race berikutnya (5K/10K/HM/FM). Murni & deterministik.
// Struktur mengikuti filosofi program Excel: 2 sesi kualitas/minggu maks, tangga menit Z4 untuk
// toleransi HR 170, recovery tiap minggu ke-4, taper sesuai jarak. Pace selalu kode intensitas.
import type { DayKey, PaceProfile, Phase, RaceDistance, RaceTarget, Segment, Session, SessionType, Week } from "@/lib/engine/types";
import { DAY_KEYS, RACE_DISTANCE_M } from "@/lib/engine/types";
import { sessionKmEst } from "@/lib/engine/build";
import { addDays, daysBetween, dayKey } from "@/lib/dates";
import { PHASE_COLOR } from "@/lib/labels";

export interface GenerateInput {
  raceId: string;
  race: { name: string; distance: RaceDistance; date: string; goal_time_s: number };
  /** Senin minggu pertama program */
  startDate: string;
  /** nomor minggu pertama (melanjutkan program sebelumnya) */
  firstWeek: number;
  /** km latihan (tanpa race) s.d. 3 minggu sebelum start (untuk aturan +10%) */
  prevWeeksKm: number[];
  /** apakah 3 minggu sebelum start memuat taper/transisi (default: ya, program dimulai setelah race) */
  prevWindowReset?: boolean;
  /** minggu transisi (pemulihan pasca race sebelumnya) */
  transitionWeeks: number;
  startKm: number;
  longestRunKm: number | null;
  runDays: DayKey[];
  longDay: DayKey;
  constraints: { hr170: boolean; injury: string | null };
  /** profil pace yang dipakai (RP = pace target race ini) */
  profile: PaceProfile;
}

export interface GeneratedProgram {
  weeks: Week[];
  sessions: Session[];
  race: RaceTarget;
  notes: string[];
}

export class GenerateError extends Error {}

export const MIN_WEEKS: Record<RaceDistance, number> = { "5k": 6, "10k": 6, hm: 8, fm: 12 };
export const MAX_WEEKS: Record<RaceDistance, number> = { "5k": 14, "10k": 16, hm: 20, fm: 24 };
const TAPER: Record<RaceDistance, number[]> = { "5k": [0.5], "10k": [0.5], hm: [0.7, 0.45], fm: [0.75, 0.6, 0.4] };
const PEAK_KM: Record<RaceDistance, number> = { "5k": 40, "10k": 45, hm: 55, fm: 70 };
/** porsi maksimum long run dari volume minggu itu */
const LONG_SHARE: Record<RaceDistance, number> = { "5k": 0.3, "10k": 0.35, hm: 0.42, fm: 0.5 };
/** long run puncak yang ideal (dipakai untuk catatan jujur bila tidak tercapai) */
const LONG_IDEAL: Record<RaceDistance, number> = { "5k": 10, "10k": 14, hm: 18, fm: 28 };
const LONG_CAP: Record<RaceDistance, number> = { "5k": 14, "10k": 18, hm: 22, fm: 32 };
const Z4_CAP: Record<RaceDistance, number> = { "5k": 30, "10k": 36, hm: 40, fm: 40 };
/** minggu transisi setelah race sebelumnya, menurut jarak race itu */
export const RECOVERY_WEEKS_AFTER: Record<RaceDistance, number> = { "5k": 0, "10k": 0, hm: 1, fm: 2 };

const r05 = (x: number) => Math.round(x * 2) / 2;
const idx = (d: DayKey) => DAY_KEYS.indexOf(d);
/** jarak hari melingkar (Minggu→Senin = 1) */
const gap = (a: DayKey, b: DayKey) => { const d = Math.abs(idx(a) - idx(b)); return Math.min(d, 7 - d); };

/** Pilih hari kualitas: sejauh mungkin dari long run & satu sama lain (≥48 jam). */
export function pickQualityDays(runDays: DayKey[], longDay: DayKey): { a: DayKey | null; b: DayKey | null } {
  const cand = runDays.filter((d) => d !== longDay).sort((x, y) => idx(x) - idx(y));
  let best: { a: DayKey; b: DayKey; score: number } | null = null;
  for (const a of cand) for (const b of cand) {
    if (idx(a) >= idx(b)) continue;
    if (gap(a, b) < 2 || gap(a, longDay) < 2 || gap(b, longDay) < 2) continue;
    const score = Math.min(gap(a, b), gap(a, longDay), gap(b, longDay));
    if (!best || score > best.score) best = { a, b, score };
  }
  if (best) return { a: best.a, b: best.b };
  const single = cand.filter((d) => gap(d, longDay) >= 2).sort((x, y) => gap(y, longDay) - gap(x, longDay))[0] ?? null;
  return { a: null, b: single };
}

// ------------------------------------------------------------------ segmen
const easySeg = (km: number): Segment[] => [{ kind: "steady", intensity: "E", hr_zone: "Z2", distance_m: Math.round(km * 1000) }];
const recSeg = (km: number): Segment[] => [{ kind: "steady", intensity: "REC", hr_zone: "Z1", distance_m: Math.round(km * 1000) }];
const stridesSeg = (km: number): Segment[] => [
  { kind: "steady", intensity: "E", hr_zone: "Z2", distance_m: Math.round(Math.max(2, km - 0.6) * 1000) },
  { kind: "strides", intensity: "S", hr_zone: null, reps: 6, distance_m: 100, note: "pulih penuh antar strides" },
];
const longSeg = (km: number): Segment[] => [{ kind: "steady", intensity: "L", hr_zone: "Z2", distance_m: Math.round(km * 1000), label: "Long run nyaman" }];
const longPaceSeg = (km: number, rpKm: number): Segment[] => [
  { kind: "steady", intensity: "L", hr_zone: "Z2", distance_m: Math.round((km - rpKm) * 1000) },
  { kind: "steady", intensity: "RP", hr_zone: "Z3-4", distance_m: Math.round(rpKm * 1000), position: "last", label: "Blok pace race" },
];
const wu = (m = 2000): Segment => ({ kind: "warmup", intensity: "WU", hr_zone: "Z1-2", distance_m: m });
const cd = (m = 1500): Segment => ({ kind: "cooldown", intensity: "WU", hr_zone: "Z1-2", distance_m: m });

function tempoSeg(z4: number): Segment[] {
  const reps = z4 <= 20 ? 2 : z4 <= 30 ? 3 : 4;
  return [
    wu(),
    { kind: "work", intensity: "T", hr_zone: "Z4", reps, duration_s: Math.round((z4 * 60) / reps), label: "Tempo (tangga Z4)" },
    { kind: "recovery", intensity: "TJOG", hr_zone: "Z1", reps: reps - 1, duration_s: 120, between_reps: true },
    cd(),
  ];
}
const vo2Seg = (): Segment[] => [
  wu(),
  { kind: "work", intensity: "N", hr_zone: "Z4-5", reps: 4, duration_s: 240, label: "4×4′" },
  { kind: "recovery", intensity: "JOG", hr_zone: "Z1", reps: 3, duration_s: 180, between_reps: true },
  cd(),
];
function racePaceSeg(d: RaceDistance, short: boolean): Segment[] {
  const rep = (reps: number, m: number, rec: number, zone: string): Segment[] => [
    wu(),
    { kind: "work", intensity: "RP", hr_zone: zone, reps, distance_m: m, label: "Pace race" },
    { kind: "recovery", intensity: "TJOG", hr_zone: "Z1", reps: reps - 1, distance_m: rec, between_reps: true },
    cd(),
  ];
  switch (d) {
    case "5k": return rep(short ? 3 : 5, 1000, 400, "Z4-5");
    case "10k": return short ? rep(3, 1000, 400, "Z4") : rep(4, 2000, 400, "Z4");
    case "hm": return short ? rep(2, 2000, 400, "Z3-4") : rep(3, 3000, 600, "Z3-4");
    case "fm": return [wu(), { kind: "steady", intensity: "RP", hr_zone: "Z3", distance_m: short ? 5000 : 10000, label: "Blok pace marathon" }, cd()];
  }
}
const shakeSeg = (): Segment[] => [
  { kind: "steady", intensity: "E", hr_zone: "Z1-2", distance_m: 3000 },
  { kind: "strides", intensity: "S", hr_zone: null, reps: 4, distance_m: 100 },
];
const raceSeg = (d: RaceDistance): Segment[] => [{ kind: "work", intensity: "RP", hr_zone: null, distance_m: RACE_DISTANCE_M[d], label: "RACE" }];

// ------------------------------------------------------------------ generator
export function generateProgram(i: GenerateInput): GeneratedProgram {
  const d = i.race.distance;
  if (!i.runDays.includes(i.longDay)) throw new GenerateError("Hari long run harus termasuk hari lari.");
  if (i.runDays.length < 3) throw new GenerateError("Minimal 3 hari lari per minggu.");
  if (i.race.date < i.startDate) throw new GenerateError("Tanggal race sebelum program dimulai.");
  let start = i.startDate;
  let total = Math.floor(daysBetween(start, i.race.date) / 7) + 1;
  const notes: string[] = [];
  const maxW = MAX_WEEKS[d] + i.transitionWeeks;
  if (total > maxW) {
    start = addDays(start, (total - maxW) * 7);
    notes.push(`Program ${MAX_WEEKS[d]} minggu (+transisi) dimulai ${start}; sebelum itu lari easy bebas seperti biasa.`);
    total = maxW;
  }
  const taper = TAPER[d];
  const main = total - i.transitionWeeks - taper.length;
  if (main < MIN_WEEKS[d] - taper.length) {
    throw new GenerateError(`Waktu terlalu singkat: ${total} minggu sampai race; ${d.toUpperCase()} butuh minimal ${MIN_WEEKS[d]} minggu (+${i.transitionWeeks} transisi).`);
  }
  // fase
  let base = Math.max(1, Math.round(main * 0.4));
  let build = Math.max(1, Math.round(main * 0.33));
  if (base + build >= main) { build = Math.max(1, main - base - 1); if (base + build >= main) base = Math.max(1, main - build - 1); }
  const phaseOf = (k: number): Phase => {
    if (k < i.transitionWeeks) return "Transisi";
    const m = k - i.transitionWeeks;
    if (m < base) return "Base";
    if (m < base + build) return "Build";
    if (m < main - 1) return "Spesifik";
    if (m < main) return "Peak";
    return "Taper";
  };

  const { a: qA, b: qB } = pickQualityDays(i.runDays, i.longDay);
  const afterLong = DAY_KEYS[(idx(i.longDay) + 1) % 7];
  const peak = r05(Math.max(PEAK_KM[d], i.startKm) * (i.constraints.injury ? 0.85 : 1));
  const growth = i.constraints.injury ? 0.06 : 0.08;
  if (i.constraints.injury) notes.push("Ada riwayat cedera: volume puncak −15% dan kenaikan per minggu lebih pelan.");
  if (!qA) notes.push("Hari lari terlalu rapat untuk 2 sesi kualitas berjarak 48 jam — hanya 1 sesi kualitas per minggu.");

  const weeks: Week[] = [];
  const sessions: Session[] = [];
  const history = [...i.prevWeeksKm];
  let lastBuildKm = i.startKm;
  // titik awal long run: long run terpanjang yang biasa (dibatasi ±40% volume awal supaya tidak melonjak)
  let prevLong = Math.min(i.longestRunKm ?? i.startKm * 0.3, i.startKm * 0.4);
  let z4 = i.constraints.hr170 ? 14 : 16;
  const raceWeekIdx = total - 1;
  let peakRef = i.startKm; // volume minggu latihan penuh terakhir (acuan taper)

  for (let k = 0; k < total; k++) {
    const weekNo = i.firstWeek + k;
    const wStart = addDays(start, k * 7);
    const phase = phaseOf(k);
    const m = k - i.transitionWeeks;
    const isTaper = phase === "Taper";
    const isRaceWeek = k === raceWeekIdx;
    const isRecovery = phase !== "Transisi" && !isTaper && m > 0 && (m + 1) % 4 === 0 && m < main - 1;
    const prev3 = history.slice(-3);
    const resetWindow = k < 3 ? (i.prevWindowReset ?? true) || weeks.some((w) => w.is_taper || w.phase === "Transisi")
      : weeks.slice(-3).some((w) => w.is_taper || w.phase === "Transisi");
    const guardCap = prev3.length === 3 && !weeks[weeks.length - 1]?.is_recovery_week && !resetWindow
      ? (prev3.reduce((a, b) => a + b, 0) / 3) * 1.08 : Infinity;

    let target: number;
    if (phase === "Transisi") target = i.startKm * 0.55;
    else if (isTaper) target = peakRef * taper[m - main];
    else if (isRecovery) target = lastBuildKm * 0.75;
    else {
      target = m === 0 ? i.startKm : Math.min(peak, lastBuildKm * (1 + growth));
      lastBuildKm = target;
    }
    target = r05(Math.max(10, Math.min(target, guardCap)));
    if (!isTaper && !isRecovery && phase !== "Transisi") { lastBuildKm = Math.min(lastBuildKm, target); peakRef = target; }

    // --- susun sesi minggu ini
    const plan: Array<{ day: DayKey; type: SessionType; hard: boolean; segs: Segment[]; z4?: number }> = [];
    const days = i.runDays.slice().sort((x, y) => idx(x) - idx(y));
    const dateOf = (day: DayKey) => addDays(wStart, idx(day));

    if (isRaceWeek) {
      const raceDay = dayKey(i.race.date) as DayKey;
      const before = (day: DayKey) => dateOf(day) < i.race.date;
      const shakeDate = addDays(i.race.date, -1);
      for (const day of days) {
        if (!before(day) || dateOf(day) === shakeDate) continue;
        const daysToRace = daysBetween(dateOf(day), i.race.date);
        if (day === qA && daysToRace >= 3) plan.push({ day, type: "race_pace", hard: true, segs: racePaceSeg(d, true) });
        else plan.push({ day, type: "easy", hard: false, segs: easySeg(Math.min(6, Math.max(3, target * 0.15))) });
      }
      if (shakeDate >= wStart) plan.push({ day: dayKey(shakeDate) as DayKey, type: "shakeout", hard: false, segs: shakeSeg() });
      plan.push({ day: raceDay, type: "race", hard: true, segs: raceSeg(d) });
    } else {
      // long run
      const longPaceWeek = (d === "hm" || d === "fm") && (phase === "Spesifik" || phase === "Peak") && m % 2 === 0;
      // long run naik +2 km/minggu (bukan % volume) sampai batas jarak; tetap ≤ porsi maksimum minggu itu
      let longKm = r05(Math.min(LONG_CAP[d], prevLong + 2, Math.max(6, target * LONG_SHARE[d])));
      if (isRecovery) longKm = r05(Math.max(6, prevLong * 0.7));
      if (isTaper) longKm = r05(Math.max(6, longKm * 0.75));
      if (!isRecovery && !isTaper && phase !== "Transisi") prevLong = Math.max(prevLong, longKm);
      if (longPaceWeek && !isTaper) {
        const rpKm = Math.min(d === "fm" ? 14 : 8, Math.max(3, r05(longKm * 0.3)));
        plan.push({ day: i.longDay, type: "long_with_pace", hard: true, segs: longPaceSeg(longKm, rpKm) });
      } else {
        plan.push({ day: i.longDay, type: "long", hard: false, segs: longSeg(longKm) });
      }
      // kualitas B: tempo (tangga Z4)
      if (qB && phase !== "Transisi") {
        let zz = z4;
        if (isRecovery) zz = Math.round(z4 * 0.6);
        if (isTaper) zz = Math.round(z4 * (m - main === 0 ? 0.6 : 0.4));
        plan.push({ day: qB, type: "tempo", hard: true, segs: tempoSeg(Math.max(10, zz)), z4: Math.max(10, zz) });
        if (!isRecovery && !isTaper) z4 = Math.min(Z4_CAP[d], z4 + 2);
      }
      // kualitas A
      if (qA && phase !== "Transisi") {
        if (phase === "Base" || isRecovery || longPaceWeek) plan.push({ day: qA, type: "easy_strides", hard: false, segs: stridesSeg(Math.max(5, r05(target * 0.15))) });
        else if (phase === "Build") plan.push({ day: qA, type: "vo2_4x4", hard: true, segs: vo2Seg() });
        else plan.push({ day: qA, type: "race_pace", hard: true, segs: racePaceSeg(d, isTaper) });
      }
      // sisa km → easy / recovery
      const used = plan.reduce((a, p) => a + sessionKmEst(p.segs, i.profile, weekNo), 0);
      const free = days.filter((day) => !plan.some((p) => p.day === day));
      let rest = target - used;
      // pakai hari sebanyak yang masih bisa diisi ≥3 km (sisanya istirahat); utamakan yang bukan sehari setelah long run
      const nDays = Math.min(free.length, Math.floor(rest / 3));
      const fill = free.slice().sort((x, y) => Number(x === afterLong) - Number(y === afterLong)).slice(0, Math.max(0, nDays));
      const per = fill.length ? rest / fill.length : 0;
      for (const day of fill) {
        if (rest < 3) break;
        const km = r05(Math.min(per, 12));
        rest -= km;
        plan.push(day === afterLong
          ? { day, type: "recovery", hard: false, segs: recSeg(Math.min(km, 8)) }
          : { day, type: "easy", hard: false, segs: easySeg(km) });
      }
    }

    // --- jaga total minggu ≤ batas: kurangi easy dulu, lalu long run
    if (!isRaceWeek) {
      const limit = Math.min(guardCap, target + 1.5);
      const kmOf = (p: (typeof plan)[number]) => sessionKmEst(p.segs, i.profile, weekNo);
      let excess = plan.reduce((a, p) => a + kmOf(p), 0) - limit;
      for (const p of plan.filter((x) => x.type === "easy" || x.type === "recovery").sort((x, y) => kmOf(y) - kmOf(x))) {
        if (excess <= 0) break;
        const km = kmOf(p);
        const cut = Math.min(excess, km - 3);
        if (cut <= 0) { plan.splice(plan.indexOf(p), 1); excess -= km; continue; }
        const nk = r05(km - cut);
        p.segs = p.type === "recovery" ? recSeg(nk) : easySeg(nk);
        excess -= km - nk;
      }
      const lp = plan.find((x) => x.type === "long" || x.type === "long_with_pace");
      if (excess > 0 && lp) {
        const nk = r05(Math.max(6, kmOf(lp) - excess));
        lp.segs = lp.type === "long" ? longSeg(nk) : longPaceSeg(nk, Math.min(nk - 3, lp.segs[1].distance_m! / 1000));
      }
    }

    // --- materialisasi
    const weekSessions: Session[] = plan
      .filter((p) => { const dt = addDays(wStart, idx(p.day)); return dt <= i.race.date; })
      .map((p) => {
        const date = addDays(wStart, idx(p.day));
        const km = sessionKmEst(p.segs, i.profile, weekNo);
        const notes: string[] = [];
        if (p.type === "tempo" && i.constraints.hr170) notes.push("HR 170: start rep 5 dtk/km lebih lambat; bila HR lewat batas, pelankan & selesaikan rep.");
        if (p.type === "race") notes.push(`Target ${i.race.name}: pace RP.`);
        return {
          id: `W${String(weekNo).padStart(2, "0")}-${p.day}`, date, week: weekNo, day: p.day, phase, type: p.type, is_hard: p.hard,
          planned_km: km, z4_target_min: p.z4 ?? null, z4_planned_min: p.z4 ?? null, mp_hmp_km: null, segments_km: km,
          segments: p.segs, notes, source_text: "generator",
        } satisfies Session;
      })
      .sort((x, y) => x.date.localeCompare(y.date));
    const km = Math.round(weekSessions.reduce((a, s) => a + s.planned_km, 0) * 10) / 10;
    history.push(weekSessions.filter((s) => s.type !== "race").reduce((a, s) => a + s.planned_km, 0));
    weeks.push({
      week: weekNo, start: wStart, phase, is_recovery_week: isRecovery, is_taper: isTaper, planned_km: km,
      hard_sessions: weekSessions.filter((s) => s.is_hard).map((s) => s.day), color: PHASE_COLOR[phase], guardrail_exception: null,
    });
    sessions.push(...weekSessions);
  }

  const maxLong = Math.max(0, ...sessions.filter((s) => s.type.startsWith("long")).map((s) => s.planned_km));
  if (maxLong < LONG_IDEAL[d]) {
    notes.push(`Long run terpanjang ${maxLong} km — di bawah ±${LONG_IDEAL[d]} km yang ideal untuk ${d.toUpperCase()}. Penyebab: volume awal ${i.startKm} km/minggu & batas kenaikan 10%. Naikkan volume dasar dulu atau pilih race lebih jauh.`);
  }
  const race: RaceTarget = {
    id: i.raceId, name: i.race.name, distance: d, distance_m: RACE_DISTANCE_M[d], date: i.race.date,
    goal_time_s: i.race.goal_time_s, first_week: i.firstWeek, last_week: i.firstWeek + total - 1, pace_code: "RP", result_time_s: null,
  };
  return { weeks, sessions, race, notes };
}

/** Senin pertama pada/sesudah tanggal. */
export function nextMonday(iso: string): string {
  const k = idx(dayKey(iso) as DayKey);
  return k === 0 ? iso : addDays(iso, 7 - k);
}
