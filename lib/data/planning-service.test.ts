import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { planningProfileSchema } from "@/lib/plan/profile";

const dir = mkdtempSync(path.join(tmpdir(), "rc-planning-"));
beforeAll(() => { process.env.LOCAL_DATA_DIR = dir; });
afterAll(() => { delete process.env.LOCAL_DATA_DIR; rmSync(dir, { recursive: true, force: true }); });

describe("tab Target → analisis → usulan → persetujuan", () => {
  it("ubah target HM ke 1:30: hanya pace H & target berubah, struktur 27 minggu tetap; bisa di-revert", async () => {
    const svc = await import("./planning-service");
    const eng = await import("./engine-service");
    const { getPlanStore } = await import("./plan-store");
    const before = await getPlanStore().getActive();
    const rec = await svc.proposeGoal(5400);
    expect(rec.mode).toBe("pending");
    expect(rec.size).toBe("large");
    expect(rec.diff.map((d) => d.label)).toEqual(expect.arrayContaining(["Pace H", "Target Half Marathon"]));
    expect((await eng.approveChange(rec.id)).ok).toBe(true);
    const after = await getPlanStore().getActive();
    expect(after.races[0].goal_time_s).toBe(5400);
    expect(after.paceProfile.default.H).toEqual([253, 258]); // 1:30 HM = 4:16/km
    expect(after.paceProfile.default.E).toEqual(before.paceProfile.default.E); // pace latihan tetap dari kebugaran
    expect(after.sessions.length).toBe(before.sessions.length);
    await eng.revertChange(rec.id);
    expect((await getPlanStore().getActive()).races[0].goal_time_s).toBe(before.races[0].goal_time_s);
  });

  it("profil + FM berikutnya → program W28+ disambung setelah HM, race aktif tetap HM", async () => {
    const svc = await import("./planning-service");
    const eng = await import("./engine-service");
    const { getPlanStore } = await import("./plan-store");
    await svc.savePlanning(planningProfileSchema.parse({
      pbs: { hm: { time_s: 6600, date: "2026-10-01" }, "10k": { time_s: 3000, date: null } },
      easy_pace_s: 370, weekly_km: 45, longest_run_km: 21, constraints: { hr170: true },
      next_race: { name: "Jakarta Marathon", distance: "fm", date: "2027-10-24", goal_time_s: 12600 },
    }));
    const view = await svc.planningView();
    expect(view.saved).toBe(true);
    expect(view.fitness.source).toBe("pb");
    expect(view.next?.startDate).toBe("2027-05-31");
    const { record } = await svc.proposeNextProgram();
    expect(record.mode).toBe("pending");
    expect((await eng.approveChange(record.id)).ok).toBe(true);
    const snap = await getPlanStore().getActive();
    expect(snap.races).toHaveLength(2);
    const fm = snap.races[1];
    expect(fm).toMatchObject({ distance: "fm", first_week: 28, pace_code: "RP", date: "2027-10-24" });
    expect(snap.sessions.find((s) => s.type === "race" && s.week === fm.last_week)?.date).toBe("2027-10-24");
    expect(snap.sessions.filter((s) => s.week <= 27)).toHaveLength(135); // program HM utuh
    expect(snap.paceProfile.default.RP).toEqual([296, 301]); // 3:30 FM = 298,6 dtk/km → 4:59 (−3/+2)
    expect((await svc.planningView()).active.id).toBe("race-1");
  });

  it("race berikutnya sebelum race aktif → ditolak dengan pesan jelas", async () => {
    const svc = await import("./planning-service");
    const p = await (await import("./plan-store")).getPlanStore().getPlanning();
    await svc.savePlanning({ ...p!, next_race: { name: "10K", distance: "10k", date: "2027-03-01", goal_time_s: 2900 } });
    await expect(svc.proposeNextProgram()).rejects.toThrow(/setelah/);
  });
});
