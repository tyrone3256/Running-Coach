import { describe, expect, it } from "vitest";
import { run, computeSize, applyProposal } from "./engine";
import { quickMoveTarget, r05FromTest, readiness } from "./rules";
import { sensorCheck, heatAdjustment, assessQuality } from "./analysis";
import { planViolations, validateChange, acwr } from "./guardrails";
import { applyChanges, inverseOf } from "./snapshot";
import { resolvePace, resolveHr, plannedZ4Minutes } from "./pace";
import { vdotFromRace } from "./vdot";
import { appliedChange, baseSnapshot, mkCheckin, mkLog, mkState, session } from "@/test/engine-fixtures";
import type { Rep } from "@/lib/log/schema";
import type { Change } from "./model";

const EASY3 = [
  { date: "2027-02-03", session_key: "W11-wed" },
  { date: "2027-02-07", session_key: "W11-sun" },
  { date: "2027-02-10", session_key: "W12-wed" },
];
const rep = (i: number, p: Partial<Rep> = {}): Rep => ({
  index: i, distance_m: null, duration_s: 600, pace_s: 292, avg_hr: 166, max_hr: 170, hr_drop_60s: 30,
  completed: true, stop_reason: null, stop_at_s: null, ...p,
});

// ================================================================= R1
describe("R1 easy terlalu berat", () => {
  it("memicu: 3 easy @6:00 HR 160 → E/L/REC +10, kecil", () => {
    const logs = EASY3.map((e) => mkLog({ ...e, avg_hr: 160, duration_s: 2880, distance_m: 8000 }));
    const r = run(mkState({ today: "2027-02-10", logs }), { kind: "log", logId: logs[2].id });
    const p = r.proposals.find((x) => x.rule === "R1")!;
    expect(p.size).toBe("small");
    expect(p.changes).toEqual([{ op: "shift_pace", codes: ["E", "L", "REC"], delta_s: 10 }]);
  });
  it("tidak memicu: hanya 1 dari 3 di atas Z2", () => {
    const logs = EASY3.map((e, i) => mkLog({ ...e, avg_hr: i === 0 ? 160 : 148, rpe: 3 }));
    const r = run(mkState({ today: "2027-02-10", logs }), { kind: "log", logId: logs[2].id });
    expect(r.proposals.some((x) => x.rule === "R1")).toBe(false);
  });
  it("batas: HR 151 (= batas atas Z2) tidak dihitung; 152 dihitung", () => {
    const at = EASY3.map((e) => mkLog({ ...e, avg_hr: 151 }));
    expect(run(mkState({ today: "2027-02-10", logs: at }), { kind: "log", logId: at[2].id }).proposals.some((x) => x.rule === "R1")).toBe(false);
    const over = EASY3.map((e) => mkLog({ ...e, avg_hr: 152 }));
    expect(run(mkState({ today: "2027-02-10", logs: over }), { kind: "log", logId: over[2].id }).proposals.some((x) => x.rule === "R1")).toBe(true);
  });
  it("toleransi +5 bpm saat ≥30°C; RPE ≥5 tetap memicu", () => {
    const hot = EASY3.map((e) => mkLog({ ...e, avg_hr: 155, temp_c: 31 }));
    expect(run(mkState({ today: "2027-02-10", logs: hot }), { kind: "log", logId: hot[2].id }).proposals.some((x) => x.rule === "R1")).toBe(false);
    const rpe = EASY3.map((e) => mkLog({ ...e, avg_hr: 140, rpe: 5 }));
    expect(run(mkState({ today: "2027-02-10", logs: rpe }), { kind: "log", logId: rpe[2].id }).proposals.some((x) => x.rule === "R1")).toBe(true);
  });
  it("maks 30 dtk/km per 2 minggu", () => {
    const logs = EASY3.map((e) => mkLog({ ...e, avg_hr: 160 }));
    const prior = [1, 2, 3].map(() => appliedChange({ rule: "R1", date: "2027-02-01", changes: [{ op: "shift_pace", codes: ["E", "L", "REC"], delta_s: 10 }] }));
    const r = run(mkState({ today: "2027-02-10", logs, changes: prior }), { kind: "log", logId: logs[2].id });
    expect(r.proposals.some((x) => x.rule === "R1")).toBe(false);
    expect(r.notices.some((n) => n.key.startsWith("R1cap"))).toBe(true);
  });
});

// ================================================================= R2
describe("R2 easy terlalu ringan", () => {
  const dates = [["2027-01-27", "W10-wed"], ["2027-01-31", "W10-sun"], ["2027-02-03", "W11-wed"], ["2027-02-07", "W11-sun"], ["2027-02-10", "W12-wed"]];
  it("memicu: 4/5 easy HR <145 & RPE ≤3 → E/L −5", () => {
    const logs = dates.map(([date, k], i) => mkLog({ date, session_key: k, avg_hr: i === 0 ? 150 : 138, rpe: 3 }));
    const r = run(mkState({ today: "2027-02-10", logs }), { kind: "log", logId: logs[4].id });
    expect(r.proposals.find((x) => x.rule === "R2")?.changes).toEqual([{ op: "shift_pace", codes: ["E", "L"], delta_s: -5 }]);
  });
  it("tidak memicu bila RPE 4", () => {
    const logs = dates.map(([date, k]) => mkLog({ date, session_key: k, avg_hr: 138, rpe: 4 }));
    expect(run(mkState({ today: "2027-02-10", logs }), { kind: "log", logId: logs[4].id }).proposals.some((x) => x.rule === "R2")).toBe(false);
  });
  it("batas: 145 bpm (=85%) tidak dihitung ringan", () => {
    const logs = dates.map(([date, k]) => mkLog({ date, session_key: k, avg_hr: 145, rpe: 2 }));
    expect(run(mkState({ today: "2027-02-10", logs }), { kind: "log", logId: logs[4].id }).proposals.some((x) => x.rule === "R2")).toBe(false);
  });
});

// ================================================================= R3
describe("R3 sesi kualitas gagal", () => {
  const vo2 = ["W09-tue", "W11-tue", "W12-tue"];
  const dates = ["2027-01-19", "2027-02-02", "2027-02-09"];
  const failLog = (i: number) => mkLog({ date: dates[i], session_key: vo2[i], reps: [1, 2, 3, 4].map((k) => rep(k, { pace_s: 300, avg_hr: 176, duration_s: 240 })), rpe: 8 });
  it("pace >3% lebih lambat = gagal; tepat batas tidak", () => {
    const snap = baseSnapshot();
    const s = session(snap, "W12-tue"); // N 4:25–4:40 → batas 280 ×1.03 = 288.4
    const ok = mkLog({ date: "2027-02-09", session_key: "W12-tue", reps: [1, 2, 3, 4].map((k) => rep(k, { pace_s: 288, avg_hr: 176 })) });
    const bad = mkLog({ date: "2027-02-09", session_key: "W12-tue", reps: [1, 2, 3, 4].map((k) => rep(k, { pace_s: 289, avg_hr: 176 })) });
    expect(assessQuality(ok, s, snap.paceProfile, 170).failed).toBe(false);
    expect(assessQuality(bad, s, snap.paceProfile, 170).failed).toBe(true);
  });
  it("gagal pertama: tidak ada perubahan", () => {
    const logs = [failLog(2)];
    expect(run(mkState({ today: "2027-02-09", logs }), { kind: "log", logId: logs[0].id }).proposals.some((p) => p.rule === "R3")).toBe(false);
  });
  it("2× gagal dalam 3 minggu → 4×4 berikutnya −20% (4 → 3 rep)", () => {
    const logs = [failLog(1), failLog(2)];
    const r = run(mkState({ today: "2027-02-09", logs }), { kind: "log", logId: logs[1].id });
    const p = r.proposals.find((x) => x.rule === "R3")!;
    const ch = p.changes[0] as Extract<Change, { op: "update_session" }>;
    expect(ch.id).toBe("W13-tue");
    expect(ch.patch.segments!.find((s) => s.kind === "work")!.reps).toBe(3);
    expect(p.size).toBe("small");
  });
  it("3× gagal → pace N +5", () => {
    const logs = [failLog(0), failLog(1), failLog(2)];
    // gagal pertama 21 hari sebelumnya → masih dalam jendela 3 minggu
    const r = run(mkState({ today: "2027-02-09", logs }), { kind: "log", logId: logs[2].id });
    expect(r.proposals.find((x) => x.rule === "R3")?.changes).toEqual([{ op: "shift_pace", codes: ["N"], delta_s: 5 }]);
  });
  it("panas & lembap: pace lambat tidak dihitung gagal (R9)", () => {
    const snap = baseSnapshot();
    const hot = mkLog({ date: "2027-02-09", session_key: "W12-tue", temp_c: 30, humidity: 80, reps: [1, 2, 3, 4].map((k) => rep(k, { pace_s: 300, avg_hr: 176 })) });
    expect(assessQuality(hot, session(snap, "W12-tue"), snap.paceProfile, 170).failed).toBe(false);
  });
  it("rep 4×4 dibatalkan karena HR tak turun → bukan gagal (R12)", () => {
    const snap = baseSnapshot();
    const l = mkLog({ date: "2027-02-09", session_key: "W12-tue", reps: [rep(1, { pace_s: 275 }), rep(2, { pace_s: 275 }), rep(3, { pace_s: 275 }), rep(4, { completed: false, stop_reason: "hr_recovery_slow", pace_s: null })] });
    const a = assessQuality(l, session(snap, "W12-tue"), snap.paceProfile, 170);
    expect(a.failed).toBe(false);
    expect(a.cancelledForRecovery).toBe(1);
  });
});

// ================================================================= R4
describe("R4 sesi kualitas terlalu mudah", () => {
  const ids = ["W11-tue", "W12-tue", "W13-tue"];
  const dates = ["2027-02-02", "2027-02-09", "2027-02-16"];
  const good = (i: number, hr = 172) => mkLog({ date: dates[i], session_key: ids[i], rpe: 7, reps: [1, 2, 3, 4].map((k) => rep(k, { pace_s: 275, avg_hr: hr, duration_s: 240 })) });
  it("3 berturut-turut on-pace, HR ≤ tengah Z5, RPE ≤7 → N −3", () => {
    const logs = [good(0), good(1), good(2)];
    const r = run(mkState({ today: "2027-02-16", logs }), { kind: "log", logId: logs[2].id });
    expect(r.proposals.find((x) => x.rule === "R4")?.changes).toEqual([{ op: "shift_pace", codes: ["N"], delta_s: -3 }]);
  });
  it("tidak memicu bila HR di atas tengah zona", () => {
    const logs = [good(0), good(1), good(2, 179)];
    expect(run(mkState({ today: "2027-02-16", logs }), { kind: "log", logId: logs[2].id }).proposals.some((x) => x.rule === "R4")).toBe(false);
  });
  it("tidak memicu dengan hanya 2 sesi", () => {
    const logs = [good(1), good(2)];
    expect(run(mkState({ today: "2027-02-16", logs }), { kind: "log", logId: logs[1].id }).proposals.some((x) => x.rule === "R4")).toBe(false);
  });
});

// ================================================================= R5
describe("R5 tes / TT", () => {
  it("tes 30′ 6,1 km HR 172 → LTHR 172 + pace dihitung ulang, BESAR, ada opsi LTHR saja", () => {
    const state = mkState({ today: "2026-12-24" });
    const p = r05FromTest(state, { type: "30min", distance_m: 6100, duration_s: 1800, avg_hr_last20: 172, date: "2026-12-24" });
    expect(p.size).toBe("large");
    expect(p.changes[0]).toEqual({ op: "set_lthr", lthr: 172, source: "test" });
    expect(p.alternatives?.[0].id).toBe("lthr_only");
    expect(p.reason).toMatch(/6,0–6,2 km/);
    const { after, diff } = applyProposal(state.snapshot, p.changes);
    expect(after.lthr).toBe(172);
    expect(resolveHr("Z4", after.lthr)).toEqual([163, 172]);
    expect(diff.some((d) => d.kind === "lthr" && d.before === "170 bpm" && d.after === "172 bpm")).toBe(true);
    expect(diff.some((d) => d.id === "H")).toBe(true);
  });
  it("hasil = target (VDOT acuan) → pace tidak bergeser", () => {
    const state = mkState({ today: "2027-02-27" });
    const tenk = 2842; // 10K setara HM 1:45 (VDOT ±42,6)
    const p = r05FromTest(state, { type: "10k_tt", distance_m: 10000, duration_s: tenk, avg_hr_last20: null, date: "2027-02-27" });
    const sp = p.changes.find((c) => c.op === "set_pace_profile") as Extract<Change, { op: "set_pace_profile" }>;
    expect(Math.abs(sp.default.H![0] - 295)).toBeLessThanOrEqual(1);
    expect(p.alternatives).toBeUndefined();
  });
  it("VDOT Daniels–Gilbert: HM 1:45 ≈ 42,6", () => {
    expect(vdotFromRace(21097.5, 6300)).toBeCloseTo(42.6, 1);
  });
});

// ================================================================= R6
describe("R6 readiness", () => {
  const base = ["2027-02-04", "2027-02-05", "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", "2027-02-10"].map((d) => mkCheckin({ date: d, resting_hr: 50 }));
  it("RHR +5 di hari kualitas → tempo jadi easy (kecil)", () => {
    const state = mkState({ today: "2027-02-11", checkins: [...base, mkCheckin({ date: "2027-02-11", resting_hr: 55 })] });
    const r = run(state, { kind: "checkin", date: "2027-02-11" });
    const p = r.proposals.find((x) => x.rule === "R6")!;
    expect(p.size).toBe("small");
    const ch = p.changes[0] as Extract<Change, { op: "update_session" }>;
    expect(ch.id).toBe("W12-thu");
    expect(ch.patch.is_hard).toBe(false);
  });
  it("batas: RHR +4 / tidur 6 j / pegal 6 → hijau", () => {
    const state = mkState({ today: "2027-02-11", checkins: [...base, mkCheckin({ date: "2027-02-11", resting_hr: 54, sleep_h: 6, soreness: 6 })] });
    expect(readiness(state, "2027-02-11").red).toBe(false);
  });
  it("hari easy: merah tapi tidak ada perubahan sesi", () => {
    const state = mkState({ today: "2027-02-10", checkins: [mkCheckin({ date: "2027-02-10", sleep_h: 5 })] });
    expect(run(state, { kind: "checkin", date: "2027-02-10" }).proposals.some((p) => p.rule === "R6")).toBe(false);
  });
  it("2 hari merah berturut-turut → sarankan rest (besar)", () => {
    const state = mkState({ today: "2027-02-11", checkins: [mkCheckin({ date: "2027-02-10", sleep_h: 5 }), mkCheckin({ date: "2027-02-11", soreness: 8 })] });
    const r = run(state, { kind: "checkin", date: "2027-02-11" });
    expect(r.proposals.find((p) => p.rule === "R6")?.size).toBe("large");
    expect(r.notices.some((n) => n.key.startsWith("R6-rest"))).toBe(true);
  });
});

// ================================================================= R7
describe("R7 sesi terlewat", () => {
  it("easy terlewat → diabaikan", () => {
    const r = run(mkState({ today: "2027-02-11" }), { kind: "daily" });
    expect(r.proposals.some((p) => p.targets?.includes("W12-wed"))).toBe(false);
  });
  it("tempo Kamis terlewat → TIDAK pernah ditaruh di Jumat, di semua minggu (engine penuh)", () => {
    const snap = baseSnapshot();
    for (const s of snap.sessions.filter((x) => x.day === "thu" && x.is_hard)) {
      const friday = new Date(Date.parse(s.date) + 86400000).toISOString().slice(0, 10);
      const tue = snap.sessions.find((x) => x.week === s.week && x.day === "tue")!;
      const logs = [mkLog({ date: tue.date, session_key: tue.id })];
      const r = run(mkState({ today: friday, logs }), { kind: "daily" });
      const moves = r.proposals.flatMap((p) => p.changes)
        .filter((c): c is Extract<Change, { op: "update_session" }> => c.op === "update_session" && c.id === s.id && !!c.patch.date);
      for (const m of moves) expect(m.patch.date, s.id).not.toBe(friday);
      // H-1 long run tidak pernah jadi target (fungsi pencari tanggal)
      const to = quickMoveTarget(snap, s, friday);
      if (to === friday) expect(snap.sessions.find((x) => x.date > friday && x.week === s.week && x.day === "sat")!.type.startsWith("long")).toBe(false);
    }
  });
  it("tempo W12 terlewat → tidak bisa dipindah (Sabtu W12 keras) → notice, tanpa perubahan", () => {
    const logs = [mkLog({ date: "2027-02-09", session_key: "W12-tue" })];
    const r = run(mkState({ today: "2027-02-12", logs }), { kind: "daily" });
    expect(r.proposals.some((p) => p.rule === "R7" && p.targets?.includes("W12-thu"))).toBe(false);
    expect(r.notices.some((n) => n.key === "R7:W12-thu")).toBe(true);
  });
  it("tempo W09 terlewat (Sabtu easy) → usul pindah ke Minggu, BESAR, recovery Minggu jadi rest", () => {
    const logs = [mkLog({ date: "2027-01-19", session_key: "W09-tue" })];
    const r = run(mkState({ today: "2027-01-22", logs }), { kind: "daily" });
    const p = r.proposals.find((x) => x.key === "R7:W09-thu")!;
    expect(p.size).toBe("large");
    const after = applyChanges(baseSnapshot(), p.changes);
    expect(session(after, "W09-thu").date).toBe("2027-01-24");
    expect(session(after, "W09-sun").status).toBe("rest");
  });
  it("long run terlewat → pindah ke Minggu", () => {
    const r = run(mkState({ today: "2027-01-24" }), { kind: "daily" });
    const p = r.proposals.find((x) => x.key === "R7:W09-sat");
    expect(p?.title).toMatch(/Minggu 2027-01-24/);
  });
  it("absen ≥1 minggu → minggu 1 70% tanpa kualitas, minggu 2 85% (besar)", () => {
    const logs = [mkLog({ date: "2027-02-01" }), mkLog({ date: "2027-02-10", session_key: "W12-wed" })];
    const r = run(mkState({ today: "2027-02-10", logs }), { kind: "log", logId: logs[1].id });
    const p = r.proposals.find((x) => x.key.startsWith("R7-absen"))!;
    expect(p.size).toBe("large");
    const after = applyChanges(baseSnapshot(), p.changes);
    expect(session(after, "W12-thu").is_hard).toBe(false);
    expect(session(after, "W12-thu").planned_km).toBe(9); // 13 × 0,7 = 9,1 → 9
    expect(session(after, "W13-wed").planned_km).toBe(7.5); // hari ke-7 = minggu 1: 11 × 0,7
    expect(session(after, "W13-sat").planned_km).toBe(20.5); // minggu 2: 24 × 0,85
    expect(session(after, "W13-thu").is_hard).toBe(true); // minggu 2 kualitas boleh
  });
});

// ================================================================= R8 / R11
describe("R8 guardrail & R11 taper", () => {
  it("program asli: pelanggaran yang ada = W12 & W27 (3 keras) + lonjakan volume yang sudah tertulis", () => {
    const v = planViolations(baseSnapshot());
    expect(v.filter((x) => x.code === "max_hard").map((x) => x.key)).toEqual(["W12", "W27"]);
    expect(v.some((x) => x.code === "consecutive_hard")).toBe(false);
  });
  it("menolak sesi keras ke-3 & hari keras berturut-turut", () => {
    const s = baseSnapshot();
    const third: Change[] = [{ op: "update_session", id: "W11-wed", patch: { is_hard: true } }];
    expect(validateChange(s, applyChanges(s, third), third, "2027-01-30").ok).toBe(false);
  });
  it("menolak lonjakan volume >10%", () => {
    const s = baseSnapshot();
    const ch: Change[] = [{ op: "update_session", id: "W09-wed", patch: { planned_km: 20 } }];
    const v = validateChange(s, applyChanges(s, ch), ch, "2027-01-10");
    expect(v.ok).toBe(false);
    expect(v.violations.join()).toMatch(/\+10%/);
  });
  it("grandfather: mengurangi W12 tetap boleh", () => {
    const s = baseSnapshot();
    const ch: Change[] = [{ op: "update_session", id: "W12-wed", patch: { planned_km: 9 } }];
    expect(validateChange(s, applyChanges(s, ch), ch, "2027-02-01").ok).toBe(true);
  });
  it("R11: taper hanya boleh mengurangi beban", () => {
    const s = baseSnapshot();
    const up: Change[] = [{ op: "update_session", id: "W26-wed", patch: { planned_km: 6.5 } }];
    expect(validateChange(s, applyChanges(s, up), up, "2027-05-18").ok).toBe(false);
    const faster: Change[] = [{ op: "shift_pace", codes: ["E"], delta_s: -5 }];
    expect(validateChange(s, applyChanges(s, faster), faster, "2027-05-18").ok).toBe(false);
    const down: Change[] = [{ op: "update_session", id: "W26-wed", patch: { planned_km: 5 } }];
    expect(validateChange(s, applyChanges(s, down), down, "2027-05-18").ok).toBe(true);
  });
  it("ACWR >1,5 → easy 7 hari ke depan −20%", () => {
    const logs = [
      ...["2027-01-12", "2027-01-19", "2027-01-26"].map((d) => mkLog({ date: d, distance_m: 10000 })),
      ...["2027-02-04", "2027-02-05", "2027-02-06", "2027-02-07", "2027-02-08"].map((d) => mkLog({ date: d, distance_m: 15000 })),
    ];
    expect(acwr(logs, "2027-02-08").ratio!).toBeGreaterThan(1.5);
    const r = run(mkState({ today: "2027-02-08", logs }), { kind: "daily" });
    expect(r.proposals.find((p) => p.rule === "R8")?.size).toBe("small");
  });
  it("ACWR butuh ≥4 minggu data", () => {
    expect(acwr([mkLog({ date: "2027-02-07" })], "2027-02-08").ratio).toBeNull();
  });
});

// ================================================================= R9
describe("R9 panas", () => {
  it("penyesuaian +10/+15/+20 hanya bila ≥28°C & ≥70%", () => {
    expect(heatAdjustment(27, 90)).toBe(0);
    expect(heatAdjustment(28, 69)).toBe(0);
    expect(heatAdjustment(28, 70)).toBe(10);
    expect(heatAdjustment(31, 80)).toBe(15);
    expect(heatAdjustment(33, 80)).toBe(20);
  });
});

// ================================================================= R10
describe("R10 nyeri & red flag", () => {
  it("nyeri 4/10 di check-in → kualitas 7 hari ke depan jadi easy", () => {
    const r = run(mkState({ today: "2027-02-08", checkins: [mkCheckin({ date: "2027-02-08", pain_score: 4, pain_location: "betis" })] }), { kind: "checkin", date: "2027-02-08" });
    const p = r.proposals.find((x) => x.rule === "R10")!;
    expect(p.targets).toEqual(["W12-tue", "W12-thu", "W12-sat"]);
  });
  it("nyeri 3/10 sekali → tidak memicu", () => {
    const r = run(mkState({ today: "2027-02-08", checkins: [mkCheckin({ date: "2027-02-08", pain_score: 3, pain_location: "betis" })] }), { kind: "checkin", date: "2027-02-08" });
    expect(r.proposals.some((x) => x.rule === "R10")).toBe(false);
  });
  it("nyeri terlokalisasi 3 hari berturut-turut → memicu", () => {
    const checkins = ["2027-02-06", "2027-02-07", "2027-02-08"].map((d) => mkCheckin({ date: d, pain_score: 2, pain_location: "lutut kanan" }));
    expect(run(mkState({ today: "2027-02-08", checkins }), { kind: "checkin", date: "2027-02-08" }).notices.some((n) => n.rule === "R10")).toBe(true);
  });
});

// ================================================================= R12
describe("R12 tangga Z4", () => {
  it("2 gagal berturut-turut di anak tangga sama → turun 1 anak tangga (−10′) + notice tinjauan", () => {
    const fail = (date: string, id: string) => mkLog({ date, session_key: id, rpe: 9, discomfort_at_hr: { flag: true, bpm: 170 }, rep_incomplete: true, reps: [rep(1), rep(2, { completed: false, stop_reason: "hr_tidak_nyaman", stop_at_s: 300 })] });
    const logs = [fail("2027-01-07", "W07-thu"), fail("2027-01-14", "W08-thu")]; // keduanya anak tangga 30′
    const r = run(mkState({ today: "2027-01-14", logs }), { kind: "log", logId: logs[1].id });
    const p = r.proposals.find((x) => x.rule === "R12")!;
    const ch = p.changes[0] as Extract<Change, { op: "update_session" }>;
    expect(ch.id).toBe("W09-thu");
    expect(ch.patch.z4_target_min).toBe(20);
    expect(r.notices.some((n) => n.key.startsWith("R12-review"))).toBe(true);
  });
  it("gagal bukan karena HR (mis. waktu) → bukan kegagalan tangga", () => {
    const l = mkLog({ date: "2027-01-07", session_key: "W07-thu", rep_incomplete: true, reps: [rep(1), rep(2), rep(3, { completed: false, stop_reason: "waktu" })] });
    const r = run(mkState({ today: "2027-01-07", logs: [l] }), { kind: "log", logId: l.id });
    expect(r.proposals.some((x) => x.rule === "R12")).toBe(false);
  });
});

// ================================================================= R13
describe("R13 validitas sensor", () => {
  it("wrist & |HR−cadence| ≤3 → curiga", () => {
    expect(sensorCheck(mkLog({ date: "2027-02-10", hr_source: "wrist", avg_hr: 172, avg_cadence: 175 })).suspect).toBe(true);
    expect(sensorCheck(mkLog({ date: "2027-02-10", hr_source: "wrist", avg_hr: 172, avg_cadence: 176 })).suspect).toBe(false);
    expect(sensorCheck(mkLog({ date: "2027-02-10", hr_source: "chest", avg_hr: 172, avg_cadence: 172 })).suspect).toBe(false);
  });
  it("lonjakan HR >20 bpm <30 dtk tanpa perubahan pace → curiga", () => {
    const t = Array.from({ length: 40 }, (_, i) => i * 5);
    const streams = { t, d: t.map((x) => x * 2.8), hr: t.map((x) => (x >= 100 ? 178 : 150)), cad: t.map(() => 170) };
    expect(sensorCheck(mkLog({ date: "2027-02-10", hr_source: "wrist", avg_hr: 160, avg_cadence: 170, streams })).suspect).toBe(true);
  });
  it("HR naik bersamaan dengan pace naik → bukan artefak", () => {
    const t = Array.from({ length: 40 }, (_, i) => i * 5);
    let d = 0;
    const dist = t.map((x) => (d += x >= 100 ? 5 * 3.6 : 5 * 2.6));
    const streams = { t, d: dist, hr: t.map((x) => (x >= 100 ? 178 : 150)), cad: t.map(() => 170) };
    expect(sensorCheck(mkLog({ date: "2027-02-10", hr_source: "wrist", avg_hr: 160, avg_cadence: 170, streams })).suspect).toBe(false);
  });
});

// ================================================================= versi & revert
describe("versi, diff & revert", () => {
  it("inverse mengembalikan snapshot persis", () => {
    const s = baseSnapshot();
    const ch: Change[] = [
      { op: "shift_pace", codes: ["E", "L"], delta_s: 10 },
      { op: "set_lthr", lthr: 172, source: "test" },
      { op: "update_session", id: "W12-thu", patch: { status: "rest" } },
    ];
    const after = applyChanges(s, ch);
    const back = applyChanges(after, inverseOf(s, ch));
    expect(back.paceProfile.default).toEqual(s.paceProfile.default);
    expect(back.lthr).toBe(170);
    expect(session(back, "W12-thu").status).toBe("planned");
    expect(session(back, "W12-thu").is_hard).toBe(true);
  });
  it("ukuran: ≤10 dtk kecil, >10 besar, pindah tanggal besar", () => {
    const s = baseSnapshot();
    expect(computeSize(s, [{ op: "shift_pace", codes: ["E"], delta_s: 10 }])).toBe("small");
    expect(computeSize(s, [{ op: "shift_pace", codes: ["E"], delta_s: 11 }])).toBe("large");
    expect(computeSize(s, [{ op: "update_session", id: "W12-thu", patch: { date: "2027-02-14" } }])).toBe("large");
  });
  it("pace sesi mendatang ikut berubah setelah shift", () => {
    const s = baseSnapshot();
    const after = applyChanges(s, [{ op: "shift_pace", codes: ["E", "L", "REC"], delta_s: 10 }]);
    const easy = session(after, "W13-wed").segments[0];
    expect(resolvePace(easy, after.paceProfile, 13)).toEqual([360, 400]);
    expect(plannedZ4Minutes(session(after, "W13-thu"), after.paceProfile)).toBeGreaterThan(0);
  });
});
