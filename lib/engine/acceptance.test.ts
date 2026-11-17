// Acceptance criteria dari brief, diuji di level engine.
import { describe, expect, it } from "vitest";
import { applyProposal, run, validateChange } from "./engine";
import { r05FromTest } from "./rules";
import { applyChanges } from "./snapshot";
import { planViolations } from "./guardrails";
import { formatPaceRange, resolveHr, resolvePace } from "./pace";
import { appliedChange, baseSnapshot, mkLog, mkState, session } from "@/test/engine-fixtures";
import type { Change, PlanSnapshot } from "./model";
import { daysBetween } from "@/lib/dates";

describe("AC1: 3 easy @6:00 HR 160 → easy diperlambat 10 dtk/km", () => {
  it("usul + diff + alasan + sesi mendatang berpace baru", () => {
    const logs = [
      mkLog({ date: "2027-02-03", session_key: "W11-wed", distance_m: 10000, duration_s: 3600, avg_hr: 160 }),
      mkLog({ date: "2027-02-07", session_key: "W11-sun", distance_m: 9000, duration_s: 3240, avg_hr: 160 }),
      mkLog({ date: "2027-02-10", session_key: "W12-wed", distance_m: 11000, duration_s: 3960, avg_hr: 160 }),
    ];
    const state = mkState({ today: "2027-02-10", logs });
    const r = run(state, { kind: "log", logId: logs[2].id });
    const p = r.proposals.find((x) => x.rule === "R1")!;
    expect(p.title).toMatch(/10 dtk\/km/);
    expect(p.reason).toMatch(/151 bpm/);
    const { after, diff } = applyProposal(state.snapshot, p.changes);
    expect(diff.find((d) => d.id === "E")).toMatchObject({ before: "5:50–6:30", after: "6:00–6:40" });
    const next = session(after, "W12-sun").segments[0];
    expect(formatPaceRange(resolvePace(next, after.paceProfile, 12))).toBe("6:15–6:50"); // REC +10
  });
});

describe("AC2: tes 30′ 6,1 km, HR 20′ terakhir 172", () => {
  it("LTHR 172, zona & pace dihitung ulang, before/after", () => {
    const state = mkState({ today: "2026-12-24" });
    const p = r05FromTest(state, { type: "30min", distance_m: 6100, duration_s: 1800, avg_hr_last20: 172, date: "2026-12-24" });
    const { after, diff } = applyProposal(state.snapshot, p.changes);
    expect(after.lthr).toBe(172);
    expect(resolveHr("Z2", 172)).toEqual([146, 153]);
    expect(diff.map((d) => d.label)).toEqual(expect.arrayContaining(["LTHR", "Pace H", "Pace T", "Pace E", "Pace N", "Pace M"]));
    expect(p.size).toBe("large"); // wajib konfirmasi
  });
});

describe("AC3: tempo 2×10′, berhenti menit ke-6 rep 2 karena HR 170 berat", () => {
  it("tempo berikutnya 4×5′ (total Z4 sama), anak tangga tidak naik, 2–3 cue", () => {
    // W07 Kamis dibuat 2×10′ di Z4 (berbasis waktu)
    const prep: Change[] = [{
      op: "update_session", id: "W07-thu", patch: {
        segments: [
          { kind: "warmup", intensity: "WU", hr_zone: "Z1-2", distance_m: 3000 },
          { kind: "work", intensity: "T", hr_zone: "Z4", reps: 2, duration_s: 600 },
          { kind: "recovery", intensity: "TJOG", hr_zone: "Z1", reps: 1, duration_s: 120, between_reps: true },
          { kind: "cooldown", intensity: "WU", hr_zone: "Z1-2", distance_m: 2000 },
        ],
        z4_target_min: 20,
      },
    }];
    const snapshot: PlanSnapshot = applyChanges(baseSnapshot(), prep);
    const log = mkLog({
      date: "2027-01-07", session_key: "W07-thu", rpe: 8, rep_incomplete: true,
      discomfort_at_hr: { flag: true, bpm: 171 },
      reps: [
        { index: 1, completed: true, duration_s: 600, pace_s: 300, avg_hr: 166 },
        { index: 2, completed: false, stop_reason: "hr_tidak_nyaman", stop_at_s: 360, duration_s: 360, pace_s: 302, avg_hr: 171 },
      ],
    });
    const r = run(mkState({ today: "2027-01-07", snapshot, logs: [log] }), { kind: "log", logId: log.id });
    const p = r.proposals.find((x) => x.rule === "R12")!;
    expect(p.size).toBe("small");
    const ch = p.changes[0] as Extract<Change, { op: "update_session" }>;
    expect(ch.id).toBe("W08-thu");
    const work = ch.patch.segments!.find((s) => s.kind === "work")!;
    expect([work.reps, work.duration_s]).toEqual([4, 300]); // 4×5′
    const rec = ch.patch.segments!.find((s) => s.kind === "recovery")!;
    expect([rec.reps, rec.duration_s]).toEqual([3, 60]); // rec 1′
    expect(ch.patch.z4_target_min).toBe(20); // W08 seharusnya 30′ → tidak naik
    expect(p.reason).toMatch(/tidak naik/);
    expect(p.cues!.length).toBeGreaterThanOrEqual(2);
    expect(p.cues!.length).toBeLessThanOrEqual(3);
    // R3 tidak ikut memotong sesi yang sama (konflik diselesaikan, R12 menang)
    expect(r.proposals.filter((x) => x.targets?.includes("W08-thu"))).toHaveLength(1);
  });
});

describe("AC4: easy dari jam (wrist) HR 172, cadence 172", () => {
  it("ditandai cadence lock dan TIDAK memicu R1", () => {
    const logs = ["W11-wed", "W11-sun", "W12-wed"].map((k, i) =>
      mkLog({ date: ["2027-02-03", "2027-02-07", "2027-02-10"][i], session_key: k, hr_source: "wrist", avg_hr: 172, avg_cadence: 172, rpe: 3 }));
    const r = run(mkState({ today: "2027-02-10", logs }), { kind: "log", logId: logs[2].id });
    expect(r.annotations[0]).toMatchObject({ log_id: logs[2].id, sensor_suspect: true });
    expect(r.notices.some((n) => n.rule === "R13" && /chest strap/.test(n.message))).toBe(true);
    expect(r.proposals.some((p) => p.rule === "R1")).toBe(false);
  });
});

describe("AC5: tempo Kamis terlewat", () => {
  it("engine TIDAK menaruhnya di Jumat (sehari sebelum long run)", () => {
    for (const [tueId, tue, thuId, fri] of [
      ["W09-tue", "2027-01-19", "W09-thu", "2027-01-22"],
      ["W12-tue", "2027-02-09", "W12-thu", "2027-02-12"],
      ["W16-tue", "2027-03-09", "W16-thu", "2027-03-12"],
    ]) {
      const r = run(mkState({ today: fri, logs: [mkLog({ date: tue, session_key: tueId })] }), { kind: "daily" });
      const moved = r.proposals.flatMap((p) => p.changes).find((c) => c.op === "update_session" && c.id === thuId && c.patch.date);
      if (moved && moved.op === "update_session") expect(moved.patch.date).not.toBe(fri);
    }
  });
});

describe("AC6: log 'nyeri dada'", () => {
  it("STOP: tidak ada saran latihan, arahan ke dokter; dibuka setelah clearance", () => {
    const log = mkLog({ date: "2027-02-13", session_key: "W12-sat", notes: "km 8 nyeri dada, berhenti" }, "2027-02-13T03:00:00.000Z");
    expect(log.safety.level).toBe("stop");
    const st = mkState({ today: "2027-02-13", logs: [log] });
    const r = run(st, { kind: "log", logId: log.id });
    expect(r.hold.active).toBe(true);
    expect(r.proposals).toEqual([]);
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0].level).toBe("stop");
    expect(r.notices[0].message).toMatch(/dokter/);
    const cleared = run({ ...st, clearances: ["2027-02-15T01:00:00.000Z"] }, { kind: "daily" });
    expect(cleared.hold.active).toBe(false);
  });
});

describe("AC7: setelah perubahan apa pun — ≤2 sesi keras/minggu, tidak ada hari keras berturut-turut", () => {
  // PRNG deterministik
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

  it("1.000 perubahan acak lewat validator tidak pernah menambah pelanggaran", () => {
    let snap = baseSnapshot();
    const grandfathered = new Map(planViolations(snap).filter((v) => v.code === "max_hard").map((v) => [v.key, v.amount]));
    let accepted = 0;
    for (let i = 0; i < 1000; i++) {
      const s = pick(snap.sessions);
      const kind = pick(["hard_on", "hard_off", "move", "rest", "km"]);
      let ch: Change;
      if (kind === "hard_on") ch = { op: "update_session", id: s.id, patch: { is_hard: true } };
      else if (kind === "hard_off") ch = { op: "update_session", id: s.id, patch: { is_hard: false } };
      else if (kind === "rest") ch = { op: "update_session", id: s.id, patch: { status: "rest" } };
      else if (kind === "km") ch = { op: "update_session", id: s.id, patch: { planned_km: Math.round(s.planned_km * (0.5 + rnd())) } };
      else {
        const off = Math.floor(rnd() * 5) - 2;
        const d = new Date(Date.parse(s.date) + off * 86400000).toISOString().slice(0, 10);
        ch = { op: "update_session", id: s.id, patch: { date: d } };
      }
      const after = applyChanges(snap, [ch]);
      if (validateChange(snap, after, [ch], "2026-11-20").ok) {
        snap = after;
        accepted++;
      }
      // invariant
      const act = snap.sessions.filter((x) => !x.status || x.status === "planned");
      for (const w of snap.weeks) {
        const n = act.filter((x) => x.week === w.week && x.is_hard).length;
        expect(n).toBeLessThanOrEqual(grandfathered.get(`W${w.week}`) ?? 2);
      }
      const hd = act.filter((x) => x.is_hard).map((x) => x.date).sort();
      for (let k = 1; k < hd.length; k++) expect(daysBetween(hd[k - 1], hd[k])).toBeGreaterThan(1);
    }
    expect(accepted).toBeGreaterThan(100); // validator tidak menolak semuanya
  });

  it("proposal engine yang lolos selalu memenuhi invariant", () => {
    const logs = [
      ...["2027-02-03", "2027-02-07", "2027-02-10"].map((d, i) => mkLog({ date: d, session_key: ["W11-wed", "W11-sun", "W12-wed"][i], avg_hr: 160 })),
    ];
    const state = mkState({ today: "2027-02-12", logs, changes: [appliedChange({ rule: "manual", date: "2027-01-01", changes: [] })] });
    for (const trigger of [{ kind: "daily" as const }, { kind: "log" as const, logId: logs[2].id }]) {
      let snap = state.snapshot;
      for (const p of run(state, trigger).proposals) {
        const after = applyChanges(snap, p.changes);
        expect(validateChange(snap, after, p.changes, state.today).ok).toBe(true);
        snap = after;
      }
    }
  });
});
