import "server-only";
import { getPlanStore } from "./plan-store";
import { loadState, proposeChange } from "./engine-service";
import { activeRace } from "@/lib/plan/defaults";
import { EMPTY_PROFILE, type PlanningProfile } from "@/lib/plan/profile";
import { analyzeGoal, estimateFitness, predictionsFor, type FitnessEstimate, type GoalAnalysis } from "@/lib/plan/fitness";
import { GenerateError, RECOVERY_WEEKS_AFTER, generateProgram, nextMonday } from "@/lib/plan/generate";
import { paceProfileFromVdot } from "@/lib/engine/vdot";
import { trainingKm } from "@/lib/engine/guardrails";
import { RACE_DISTANCE_M, RACE_LABEL, type PacedCode, type PaceRange, type RaceTarget } from "@/lib/engine/types";
import type { Change, EngineState, PlanChangeRecord } from "@/lib/engine/model";
import { addDays, daysBetween } from "@/lib/dates";
import { formatRaceTime } from "@/lib/plan/time";

export interface PlanningView {
  profile: PlanningProfile;
  saved: boolean;
  fitness: FitnessEstimate;
  predictions: ReturnType<typeof predictionsFor>;
  programVdot: number;
  active: RaceTarget;
  activeAnalysis: GoalAnalysis;
  next: { analysis: GoalAnalysis; startDate: string } | null;
  logsWeeklyKm: number | null;
}

/** Rata-rata km/minggu dari log 4 minggu terakhir (null bila log < 2 minggu). */
export function logsWeeklyKm(st: EngineState): number | null {
  const from = addDays(st.today, -28);
  const logs = st.logs.filter((l) => l.date > from && l.date <= st.today);
  if (!logs.length || daysBetween(logs.map((l) => l.date).sort()[0], st.today) < 10) return null;
  return Math.round(logs.reduce((a, l) => a + l.distance_m, 0) / 1000 / 4);
}

const paceRange = (goalPace: number): PaceRange => [goalPace - 3, goalPace + 2];

function nextStartDate(st: EngineState, active: RaceTarget) {
  return nextMonday(active.date >= st.today ? addDays(active.date, 1) : addDays(st.today, 1));
}

export async function planningView(): Promise<PlanningView> {
  const [st, saved] = await Promise.all([loadState(), getPlanStore().getPlanning()]);
  const profile = saved ?? EMPTY_PROFILE;
  const programVdot = st.snapshot.paceProfile.vdot_ref ?? 42.6;
  const fitness = estimateFitness(profile, programVdot, st.today);
  const active = activeRace(st.snapshot, st.today);
  const activeAnalysis = analyzeGoal(fitness.vdot, active.distance, active.goal_time_s, st.today, active.date);
  let next: PlanningView["next"] = null;
  if (profile.next_race) {
    const startDate = nextStartDate(st, active);
    next = { startDate, analysis: analyzeGoal(fitness.vdot, profile.next_race.distance, profile.next_race.goal_time_s, startDate, profile.next_race.date) };
  }
  return { profile, saved: !!saved, fitness, predictions: predictionsFor(fitness.vdot), programVdot, active, activeAnalysis, next, logsWeeklyKm: logsWeeklyKm(st) };
}

export async function savePlanning(p: PlanningProfile) {
  await getPlanStore().savePlanning(p);
}

/** Target baru untuk race aktif: struktur program tetap, hanya pace race (kode H/M/RP) yang diganti. */
export async function proposeGoal(goal_time_s: number): Promise<PlanChangeRecord> {
  const st = await loadState();
  const race = activeRace(st.snapshot, st.today);
  if (race.date < st.today) throw new Error("Race aktif sudah lewat — buat program race berikutnya di bawah.");
  const pace = Math.round(goal_time_s / (RACE_DISTANCE_M[race.distance] / 1000));
  const changes: Change[] = [
    { op: "set_race_goal", race_id: race.id, goal_time_s },
    { op: "set_pace_profile", default: { [race.pace_code]: paceRange(pace) } as Partial<Record<PacedCode, PaceRange>>, base_phase: {} },
  ];
  return proposeChange({
    key: `goal:${race.id}`, rule: "manual", size: "large",
    title: `Target ${race.name}: ${formatRaceTime(race.goal_time_s)} → ${formatRaceTime(goal_time_s)}`,
    reason: `Struktur ${race.last_week - race.first_week + 1} minggu tetap; sesi pace race (kode ${race.pace_code}) memakai pace target baru ${Math.floor(pace / 60)}:${String(pace % 60).padStart(2, "0")}/km. Pace latihan lain tetap dari kebugaran sekarang.`,
    changes,
  });
}

/** Kalibrasi pace latihan (E/L/T/N/…) ke kebugaran dari tab Target; pace race tidak disentuh. */
export async function proposeRecalibration(): Promise<PlanChangeRecord> {
  const [st, view] = await Promise.all([loadState(), planningView()]);
  const ref = st.snapshot.paceProfile.vdot_ref ?? 42.6;
  const calc = paceProfileFromVdot(view.fitness.vdot, st.snapshot.paceProfile, ref);
  const raceCodes = new Set(st.snapshot.races.map((r) => r.pace_code));
  const def = Object.fromEntries(Object.entries(calc.default).filter(([c]) => !raceCodes.has(c as never)));
  const base = Object.fromEntries(Object.entries(calc.base_phase).filter(([c]) => !raceCodes.has(c as never)));
  return proposeChange({
    key: "recalibrate", rule: "manual", size: "large",
    title: `Kalibrasi pace latihan: VDOT ${ref.toLocaleString("id-ID")} → ${view.fitness.vdot.toLocaleString("id-ID")}`,
    reason: `Kebugaran ${view.fitness.detail}. Pace latihan digeser relatif terhadap kalibrasi program (bukan angka Daniels mentah); pace race tetap mengikuti target.`,
    changes: [{ op: "set_pace_profile", default: def, base_phase: base, vdot_ref: view.fitness.vdot }],
    evidence: { fitness: view.fitness },
  });
}

/** Program race berikutnya: disambung setelah race aktif (nomor minggu melanjutkan). */
export async function proposeNextProgram(): Promise<{ record: PlanChangeRecord; notes: string[] }> {
  const [st, saved] = await Promise.all([loadState(), getPlanStore().getPlanning()]);
  if (!saved?.next_race) throw new Error("Isi dulu race berikutnya di tab Target.");
  const nr = saved.next_race;
  const snap = st.snapshot;
  const active = activeRace(snap, st.today);
  if (nr.date <= active.date && active.date >= st.today) throw new Error(`Race berikutnya harus setelah ${active.name} (${active.date}). Untuk mengubah target race aktif, pakai "Ubah target".`);
  // ganti program masa depan yang sudah dibuat sebelumnya (buat ulang), atau sambung setelah minggu terakhir
  const future = snap.races.find((r) => r.id !== active.id && r.date > active.date && r.first_week > active.last_week);
  const fromWeek = future?.first_week ?? Math.max(...snap.weeks.map((w) => w.week)) + 1;
  const startDate = nextStartDate(st, active);
  const raceGap = daysBetween(active.date, startDate);
  const transitionWeeks = raceGap <= 21 ? RECOVERY_WEEKS_AFTER[active.distance] : 0;
  const prevWeeks = snap.weeks.filter((w) => w.week < fromWeek).slice(-3);
  const lastFull = snap.weeks.filter((w) => w.week < fromWeek && !w.is_taper && !w.is_recovery_week).slice(-1)[0];
  const startKm = Math.round(saved.weekly_km ?? logsWeeklyKm(st) ?? (lastFull ? lastFull.planned_km * 0.85 : 30));
  const goalPace = Math.round(nr.goal_time_s / (RACE_DISTANCE_M[nr.distance] / 1000));
  const profile = { ...snap.paceProfile, default: { ...snap.paceProfile.default, RP: paceRange(goalPace) } };
  const raceId = `race-${snap.races.length + 1}-${nr.date}`;
  try {
    const gp = generateProgram({
      raceId, race: nr, startDate, firstWeek: fromWeek,
      prevWeeksKm: prevWeeks.map((w) => trainingKm(snap, w.week)),
      prevWindowReset: true,
      transitionWeeks, startKm, longestRunKm: saved.longest_run_km,
      runDays: saved.run_days, longDay: saved.long_day,
      constraints: { hr170: saved.constraints.hr170, injury: saved.constraints.injury },
      profile,
    });
    const races = [...snap.races.filter((r) => r.first_week < fromWeek), gp.race];
    const total = Math.round(gp.weeks.reduce((a, w) => a + w.planned_km, 0));
    const record = await proposeChange({
      key: "next-program", rule: "manual", size: "large",
      title: `Program ${RACE_LABEL[nr.distance]} ${formatRaceTime(nr.goal_time_s)} · ${gp.weeks.length} minggu (W${fromWeek}–W${gp.race.last_week})`,
      reason: `Mulai ${startDate}${transitionWeeks ? ` (${transitionWeeks} minggu transisi setelah ${active.name})` : ""}, race ${nr.date}. Total ±${total} km. Pace race RP = ${Math.floor(goalPace / 60)}:${String(goalPace % 60).padStart(2, "0")}/km; pace latihan dari kebugaran sekarang.${gp.notes.length ? " " + gp.notes.join(" ") : ""}`,
      changes: [
        { op: "set_pace_profile", default: { RP: profile.default.RP }, base_phase: {} },
        { op: "set_program_tail", from_week: fromWeek, weeks: gp.weeks, sessions: gp.sessions, races },
      ],
      evidence: { startKm, transitionWeeks, notes: gp.notes },
    });
    return { record, notes: gp.notes };
  } catch (e) {
    if (e instanceof GenerateError) throw new Error(e.message);
    throw e;
  }
}
