// R8 (guardrail beban) + R11 (taper). Validator dipanggil untuk SETIAP perubahan.
// Prinsip grandfather: pelanggaran yang sudah ada di plan sebelum perubahan (mis. W12 dan
// W27 di program asli, keputusan D5/D6 belum diambil) tidak memblokir — tapi perubahan
// tidak boleh MENAMBAH pelanggaran baru atau memperburuknya.
import type { Change, PlanSnapshot } from "./model";
import { isActive } from "./snapshot";
import { daysBetween } from "@/lib/dates";
import type { WorkoutLog } from "@/lib/log/schema";

/** Program Excel: taper W25–W27 (kini dibaca dari flag is_taper per minggu). */
export const TAPER_FROM_WEEK = 25;
export const MAX_HARD_PER_WEEK = 2;
export const VOLUME_MAX_INCREASE = 0.1;

export interface Violation {
  code: "max_hard" | "consecutive_hard" | "volume_jump" | "taper_increase";
  key: string;
  message: string;
  /** besaran untuk perbandingan "lebih buruk" */
  amount: number;
}

function activeSessions(s: PlanSnapshot) {
  return s.sessions.filter(isActive);
}

export function weekKm(s: PlanSnapshot, week: number): number {
  return activeSessions(s).filter((x) => x.week === week).reduce((a, x) => a + x.planned_km, 0);
}

/** Km latihan (tanpa race itu sendiri) — dasar aturan kenaikan volume. */
export function trainingKm(s: PlanSnapshot, week: number): number {
  return activeSessions(s).filter((x) => x.week === week && x.type !== "race").reduce((a, x) => a + x.planned_km, 0);
}

export function planViolations(s: PlanSnapshot): Violation[] {
  const out: Violation[] = [];
  const act = activeSessions(s);
  for (const w of s.weeks) {
    const hard = act.filter((x) => x.week === w.week && x.is_hard);
    if (hard.length > MAX_HARD_PER_WEEK) {
      out.push({
        code: "max_hard", key: `W${w.week}`, amount: hard.length,
        message: `W${String(w.week).padStart(2, "0")}: ${hard.length} sesi keras (maks ${MAX_HARD_PER_WEEK})`,
      });
    }
    // volume latihan ≤ +10% vs rata-rata 3 minggu sebelumnya. Tidak dinilai setelah minggu pemulihan,
    // dan tidak saat jendela 3 minggu masih memuat taper/transisi (membangun ulang setelah race).
    const prev = s.weeks.filter((x) => x.week < w.week && x.week >= w.week - 3);
    const prevWeek = s.weeks.find((x) => x.week === w.week - 1);
    const reset = prev.some((x) => x.is_taper || x.phase === "Transisi");
    if (prev.length === 3 && !prevWeek?.is_recovery_week && !reset) {
      const avg = prev.reduce((a, x) => a + trainingKm(s, x.week), 0) / 3;
      const km = trainingKm(s, w.week);
      if (km > avg * (1 + VOLUME_MAX_INCREASE) + 0.05) {
        out.push({
          code: "volume_jump", key: `W${w.week}`, amount: km / avg,
          message: `W${String(w.week).padStart(2, "0")}: ${km.toFixed(1)} km > +10% dari rata-rata 3 minggu (${avg.toFixed(1)} km)`,
        });
      }
    }
  }
  const hardDates = act.filter((x) => x.is_hard).map((x) => x.date).sort();
  for (let i = 1; i < hardDates.length; i++) {
    if (daysBetween(hardDates[i - 1], hardDates[i]) <= 1) {
      out.push({
        code: "consecutive_hard", key: `${hardDates[i - 1]}+${hardDates[i]}`, amount: 1,
        message: `Hari keras berturut-turut: ${hardDates[i - 1]} & ${hardDates[i]}`,
      });
    }
  }
  return out;
}

/** Apakah perubahan menaikkan beban di minggu taper (R11)? */
function taperIncreases(before: PlanSnapshot, after: PlanSnapshot, changes: Change[], today: string): string[] {
  const msgs: string[] = [];
  // minggu taper ditandai di plan (Excel: W25–W27; program buatan generator: sesuai jaraknya)
  const taperWeek = (w: number) => !!before.weeks.find((x) => x.week === w)?.is_taper || !!after.weeks.find((x) => x.week === w)?.is_taper;
  for (const ch of changes) {
    if (ch.op !== "update_session") continue;
    const a = before.sessions.find((x) => x.id === ch.id)!;
    const b = after.sessions.find((x) => x.id === ch.id)!;
    if (!taperWeek(a.week) && !taperWeek(b.week)) continue;
    const kmA = isActive(a) ? a.planned_km : 0;
    const kmB = isActive(b) ? b.planned_km : 0;
    if (kmB > kmA + 0.05) msgs.push(`Taper: ${ch.id} volume naik ${kmA}→${kmB} km`);
    if (isActive(b) && b.is_hard && !(isActive(a) && a.is_hard)) msgs.push(`Taper: ${ch.id} jadi sesi keras`);
    if (a.date !== b.date && taperWeek(b.week)) msgs.push(`Taper: ${ch.id} dipindah (susunan taper tidak diubah)`);
  }
  // pace lebih cepat saat sudah masuk taper
  const todayWeek = before.weeks.slice().reverse().find((w) => w.start <= today)?.week ?? 0;
  if (taperWeek(todayWeek)) {
    for (const ch of changes) {
      if (ch.op === "shift_pace" && ch.delta_s < 0) msgs.push("Taper: pace tidak boleh dipercepat");
      if (ch.op === "set_pace_profile") {
        for (const [c, r] of Object.entries(ch.default)) {
          const old = before.paceProfile.default[c as keyof typeof before.paceProfile.default];
          if (r && old && r[0] < old[0]) msgs.push(`Taper: pace ${c} tidak boleh dipercepat`);
        }
      }
    }
  }
  return msgs;
}

export interface ValidationResult {
  ok: boolean;
  violations: string[];
}

export function validateChange(
  before: PlanSnapshot, after: PlanSnapshot, changes: Change[], today: string,
): ValidationResult {
  const vb = planViolations(before);
  const va = planViolations(after);
  // Volume: hanya minggu yang volumenya NAIK karena perubahan ini yang dinilai. Mengurangi
  // beban satu minggu tidak boleh dianggap "membuat minggu berikutnya melonjak".
  const touched = new Set<number>();
  for (const ch of changes) {
    if (ch.op !== "update_session") continue;
    const a = before.sessions.find((x) => x.id === ch.id);
    const b = after.sessions.find((x) => x.id === ch.id);
    if (a) touched.add(a.week);
    if (b) touched.add(b.week);
  }
  const increased = (key: string) => {
    const w = Number(key.slice(1));
    return touched.has(w) && weekKm(after, w) > weekKm(before, w) + 0.05;
  };
  const worse = va.filter((v) => {
    if (v.code === "volume_jump" && !increased(v.key)) return false;
    const old = vb.find((x) => x.code === v.code && x.key === v.key);
    return !old || v.amount > old.amount + 1e-9;
  });
  const msgs = [...worse.map((v) => v.message), ...taperIncreases(before, after, changes, today)];
  return { ok: msgs.length === 0, violations: msgs };
}

// ------------------------------------------------------------------ ACWR (R8)
/** Acute:chronic workload ratio berbasis km log (7 hari vs rata-rata mingguan 28 hari). */
export function acwr(logs: WorkoutLog[], today: string): { ratio: number | null; acute: number; chronic: number } {
  const km = (from: number, to: number) => logs
    .filter((l) => { const d = daysBetween(l.date, today); return d >= from && d < to; })
    .reduce((a, l) => a + l.distance_m / 1000, 0);
  const first = logs.map((l) => l.date).sort()[0];
  const acute = km(0, 7);
  const chronic = km(0, 28) / 4;
  if (!first || daysBetween(first, today) < 27 || chronic === 0) return { ratio: null, acute, chronic };
  return { ratio: acute / chronic, acute, chronic };
}
