import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "rc-engine-"));
beforeAll(() => { process.env.LOCAL_DATA_DIR = dir; });
afterAll(() => { delete process.env.LOCAL_DATA_DIR; rmSync(dir, { recursive: true, force: true }); });

const base = {
  max_hr: 158, hr_source: "chest" as const, avg_cadence: 172, rpe: 3, reps: [], time_in_zone: null, hr_drop_1min: null,
  discomfort_at_hr: { flag: false, bpm: null }, rep_incomplete: false, temp_c: 27, humidity: 75,
  pain: { score: 0, location: null, sharp: false }, red_flags: [], notes: null, source: "manual" as const,
  external_id: null, streams: null, distance_m: 10000, duration_s: 3600,
};

describe("engine-service (file store)", () => {
  it("3 easy HR 160 → perubahan kecil diterapkan otomatis jadi versi baru, lalu bisa di-revert", async () => {
    const { getStore } = await import("./store");
    const { getPlanStore } = await import("./plan-store");
    const svc = await import("./engine-service");
    const store = getStore();
    let last;
    for (const [date, key] of [["2027-02-03", "W11-wed"], ["2027-02-07", "W11-sun"], ["2027-02-10", "W12-wed"]]) {
      const { log } = await store.saveLog({ ...base, date, session_key: key, avg_hr: 160 });
      last = await svc.processTrigger({ kind: "log", logId: log.id }, date);
    }
    expect(last!.applied.map((c) => c.rule)).toEqual(["R1"]);
    const ps = getPlanStore();
    const active = await ps.getActive();
    expect(active.version).toBe(2);
    expect(active.paceProfile.default.E).toEqual([360, 400]);

    // engine yang sama tidak mengusulkan ulang (dedupe)
    const again = await svc.processTrigger({ kind: "log", logId: (await store.listLogs())[0].id }, "2027-02-10");
    expect(again.applied).toEqual([]);

    await svc.revertChange(last!.applied[0].id);
    const reverted = await ps.getActive();
    expect(reverted.version).toBe(3);
    expect(reverted.paceProfile.default.E).toEqual([350, 390]);
    const changes = await ps.listChanges();
    expect(changes.find((c) => c.rule === "R1")!.reverted_by).toBeTruthy();
  });

  it("tes 30′ → perubahan BESAR pending; approve opsi 'LTHR saja' → LTHR 172, pace tetap", async () => {
    const svc = await import("./engine-service");
    const { getPlanStore } = await import("./plan-store");
    const rec = await svc.submitTest({ type: "30min", distance_m: 6100, duration_s: 1800, avg_hr_last20: 172, date: "2026-12-24" });
    expect(rec.mode).toBe("pending");
    expect(rec.diff.some((d) => d.kind === "lthr")).toBe(true);
    const before = await getPlanStore().getActive();
    await svc.approveChange(rec.id, "lthr_only");
    const after = await getPlanStore().getActive();
    expect(after.lthr).toBe(172);
    expect(after.paceProfile.default).toEqual(before.paceProfile.default);
  });

  it("red flag → hold; clearance membuka", async () => {
    const { getStore } = await import("./store");
    const svc = await import("./engine-service");
    const { log } = await getStore().saveLog({ ...base, date: "2027-02-13", session_key: "W12-sat", avg_hr: 150, red_flags: ["chest_pain"] });
    const r = await svc.processTrigger({ kind: "log", logId: log.id }, "2027-02-13");
    expect(r.hold.active).toBe(true);
    expect(r.applied).toEqual([]);
    await svc.clearHold("EKG normal");
    const r2 = await svc.processTrigger({ kind: "daily" }, "2027-02-14");
    expect(r2.hold.active).toBe(false);
  });
});
