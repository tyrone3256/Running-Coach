import { describe, expect, it } from "vitest";
import { GenerateError, generateProgram, nextMonday, pickQualityDays, type GenerateInput } from "./generate";
import { analyzeGoal, estimateFitness } from "./fitness";
import { EMPTY_PROFILE, planningProfileSchema } from "./profile";
import { baseSnapshot } from "@/test/engine-fixtures";
import { applyChanges } from "@/lib/engine/snapshot";
import { planViolations } from "@/lib/engine/guardrails";
import { addDays, daysBetween } from "@/lib/dates";
import type { DayKey, RaceDistance } from "@/lib/engine/types";

const snap = baseSnapshot();
const lastWeek = snap.weeks[snap.weeks.length - 1];
const profile = { ...snap.paceProfile, default: { ...snap.paceProfile.default, RP: [250, 255] as [number, number] } };

function input(d: RaceDistance, raceDate: string, over: Partial<GenerateInput> = {}): GenerateInput {
  return {
    raceId: "race-2",
    race: { name: `Race ${d}`, distance: d, date: raceDate, goal_time_s: { "5k": 1500, "10k": 3000, hm: 6300, fm: 12600 }[d] },
    startDate: nextMonday(addDays(snap.races[0].date, 1)),
    firstWeek: lastWeek.week + 1,
    prevWeeksKm: snap.weeks.slice(-3).map((w) => w.planned_km),
    transitionWeeks: 1,
    startKm: 35,
    longestRunKm: 21,
    runDays: ["tue", "wed", "thu", "sat", "sun"],
    longDay: "sat",
    constraints: { hr170: true, injury: null },
    profile,
    ...over,
  };
}

function combine(gp: ReturnType<typeof generateProgram>) {
  return applyChanges(snap, [{ op: "set_program_tail", from_week: gp.race.first_week, weeks: gp.weeks, sessions: gp.sessions, races: [...snap.races, gp.race] }]);
}

describe("generator program", () => {
  const cases: Array<[RaceDistance, number]> = [["5k", 8], ["10k", 10], ["hm", 14], ["fm", 18], ["fm", 30], ["hm", 9]];
  it.each(cases)("%s dalam %i minggu: tanpa pelanggaran guardrail, race di tanggalnya, taper turun", (d, w) => {
    const start = nextMonday(addDays(snap.races[0].date, 1));
    const raceDate = addDays(start, w * 7 - 1); // Minggu
    const gp = generateProgram(input(d, raceDate));
    const all = combine(gp);
    const newWeeks = new Set(gp.weeks.map((x) => x.week));
    const v = planViolations(all).filter((x) => newWeeks.has(Number(x.key.match(/^W(\d+)/)?.[1] ?? 0)) || x.code === "consecutive_hard" && gp.sessions.some((s) => x.key.includes(s.date)));
    expect(v, JSON.stringify(v)).toEqual([]);
    const race = gp.sessions.find((s) => s.type === "race")!;
    expect(race.date).toBe(raceDate);
    expect(gp.sessions.every((s) => s.date <= raceDate)).toBe(true);
    expect(gp.race.last_week).toBe(gp.weeks[gp.weeks.length - 1].week);
    expect(new Set(gp.sessions.map((s) => s.id)).size).toBe(gp.sessions.length);
    expect(gp.weeks.every((x) => x.hard_sessions.length <= 2)).toBe(true);
    const taper = gp.weeks.filter((x) => x.is_taper);
    for (let k = 1; k < taper.length - 1; k++) expect(taper[k].planned_km).toBeLessThanOrEqual(taper[k - 1].planned_km);
    expect(gp.weeks[0].phase).toBe("Transisi");
    expect(gp.sessions.filter((s) => s.week === gp.weeks[0].week).every((s) => !s.is_hard)).toBe(true);
  });

  it("long run tidak melewati batas jarak & naik maks 2 km", () => {
    const start = nextMonday(addDays(snap.races[0].date, 1));
    const gp = generateProgram(input("fm", addDays(start, 20 * 7 - 1), { startKm: 45 }));
    const longs = gp.sessions.filter((s) => s.type.startsWith("long")).map((s) => s.planned_km);
    expect(Math.max(...longs)).toBeLessThanOrEqual(32);
    // dibanding long run terpanjang sebelumnya (termasuk long run biasa sebelum program: 21 km)
    for (let k = 1; k < longs.length; k++) expect(longs[k] - Math.max(21, ...longs.slice(0, k))).toBeLessThanOrEqual(2.5);
    expect(Math.max(...longs)).toBeGreaterThanOrEqual(28); // FM 20 minggu dari 35 km: long run cukup panjang
  });

  it("tangga Z4 naik bertahap dan dibatasi", () => {
    const start = nextMonday(addDays(snap.races[0].date, 1));
    const gp = generateProgram(input("hm", addDays(start, 16 * 7 - 1)));
    const z = gp.sessions.filter((s) => s.type === "tempo").map((s) => s.z4_target_min!);
    expect(z[0]).toBe(14);
    expect(Math.max(...z)).toBeLessThanOrEqual(40);
  });

  it("terlalu singkat → error yang jelas", () => {
    const start = nextMonday(addDays(snap.races[0].date, 1));
    expect(() => generateProgram(input("fm", addDays(start, 6 * 7 - 1)))).toThrow(GenerateError);
  });

  it("hari lari rapat → hanya 1 sesi kualitas (tidak ada 2 hari keras berturut-turut)", () => {
    const days: DayKey[] = ["fri", "sat", "sun"];
    expect(pickQualityDays(days, "sun")).toEqual({ a: null, b: "fri" }); // Jumat keras, Minggu long: 48 jam
    expect(pickQualityDays(["tue", "wed", "thu", "sat", "sun"], "sat")).toEqual({ a: "tue", b: "thu" });
    const start = nextMonday(addDays(snap.races[0].date, 1));
    const gp = generateProgram(input("10k", addDays(start, 10 * 7 - 1), { runDays: ["mon", "wed", "fri", "sun"], longDay: "sun" }));
    expect(planViolations(combine(gp)).filter((x) => x.code === "consecutive_hard" && gp.sessions.some((s) => x.key.includes(s.date)))).toEqual([]);
  });

  it("riwayat cedera → puncak volume lebih rendah", () => {
    const start = nextMonday(addDays(snap.races[0].date, 1));
    const a = generateProgram(input("hm", addDays(start, 16 * 7 - 1)));
    const b = generateProgram(input("hm", addDays(start, 16 * 7 - 1), { constraints: { hr170: true, injury: "ITB kanan" } }));
    const sum = (g: typeof a) => g.weeks.reduce((t, w) => t + w.planned_km, 0);
    expect(sum(b)).toBeLessThan(sum(a));
  });
});

describe("analisis kebugaran & target", () => {
  const today = "2027-06-07";
  it("PB HM 1:52 → VDOT ±40; target FM 3:30 dalam 18 minggu dinilai jujur", () => {
    const p = planningProfileSchema.parse({ ...EMPTY_PROFILE, pbs: { hm: { time_s: 6720, date: "2027-05-30" } }, constraints: {} });
    const f = estimateFitness(p, 42.6, today);
    expect(f.source).toBe("pb");
    expect(f.vdot).toBeGreaterThan(39);
    expect(f.vdot).toBeLessThan(41);
    const g = analyzeGoal(f.vdot, "fm", 12600, today, addDays(today, 18 * 7));
    expect(g.goalVdot).toBeGreaterThan(44);
    expect(["ambisius", "sangat_ambisius"]).toContain(g.rating);
    expect(g.realistic_s).toBeGreaterThan(12600);
    expect(g.goalPace_s).toBe(299);
  });

  it("PB lama dikurangi; tanpa PB dipakai pace easy lalu kalibrasi program", () => {
    const old = planningProfileSchema.parse({ pbs: { "10k": { time_s: 2700, date: "2024-01-01" } }, constraints: {} });
    const f = estimateFitness(old, 42.6, today);
    expect(f.warnings.join(" ")).toMatch(/berumur/);
    const easy = estimateFitness(planningProfileSchema.parse({ pbs: {}, easy_pace_s: 370, constraints: {} }), 42.6, today);
    expect(easy.source).toBe("easy_pace");
    const none = estimateFitness(EMPTY_PROFILE, 42.6, today);
    expect(none).toMatchObject({ source: "program", vdot: 42.6 });
  });

  it("target sudah di bawah kebugaran → dalam jangkauan", () => {
    expect(analyzeGoal(45, "hm", 6600, today, addDays(today, 70)).rating).toBe("dalam_jangkauan");
  });

  it("long day harus termasuk hari lari", () => {
    expect(planningProfileSchema.safeParse({ pbs: {}, constraints: {}, run_days: ["tue", "thu", "sun"], long_day: "sat" }).success).toBe(false);
    expect(daysBetween("2027-06-07", nextMonday("2027-06-08"))).toBe(7);
  });
});
