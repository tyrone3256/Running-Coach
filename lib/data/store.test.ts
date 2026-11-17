import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileStore } from "./store";
import { workoutLogSchema, type WorkoutLogInput } from "@/lib/log/schema";

const dir = mkdtempSync(path.join(tmpdir(), "rc-store-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const store = fileStore(dir);

const base: WorkoutLogInput = workoutLogSchema.parse({
  date: "2026-11-25", session_key: "W01-wed", distance_m: 6000, duration_s: 2160,
  avg_hr: 150, max_hr: 158, hr_source: "wrist", avg_cadence: 172, rpe: 4,
  time_in_zone: null, hr_drop_1min: null, discomfort_at_hr: { flag: false, bpm: null },
  rep_incomplete: false, temp_c: 27, humidity: 80, pain: { score: 0, location: null, sharp: false },
  notes: null, source: "manual", external_id: null, streams: null,
});

describe("fileStore", () => {
  it("simpan log → pace & safety dihitung", async () => {
    const { log, duplicate } = await store.saveLog(base);
    expect(duplicate).toBe(false);
    expect(log.avg_pace_s).toBe(360);
    expect(log.safety.level).toBe("ok");
    expect(await store.getLog(log.id)).toMatchObject({ distance_m: 6000 });
  });
  it("import file yang sama dua kali tidak dobel", async () => {
    const imp = { ...base, source: "fit" as const, external_id: "fit:2026-11-26T23:00:00Z:6000", date: "2026-11-27" };
    const a = await store.saveLog(imp);
    const b = await store.saveLog(imp);
    expect(b.duplicate).toBe(true);
    expect(b.log.id).toBe(a.log.id);
  });
  it("log 'nyeri dada' tersimpan dengan safety STOP", async () => {
    const { log } = await store.saveLog({ ...base, date: "2026-11-28", notes: "nyeri dada di km 4" });
    expect(log.safety.level).toBe("stop");
  });
  it("list urut terbaru, filter rentang", async () => {
    const all = await store.listLogs();
    expect(all.map((l) => l.date)).toEqual(["2026-11-28", "2026-11-27", "2026-11-25"]);
    expect(await store.listLogs({ from: "2026-11-27", to: "2026-11-27" })).toHaveLength(1);
  });
  it("check-in upsert per tanggal", async () => {
    const c = { date: "2026-11-25", resting_hr: 52, sleep_h: 7, soreness: 3, pain_score: 0, pain_location: null, hrv: null };
    await store.saveCheckin(c);
    await store.saveCheckin({ ...c, sleep_h: 5.5 });
    expect(await store.listCheckins("2026-11-01", "2026-11-30")).toHaveLength(1);
    expect((await store.getCheckin("2026-11-25"))?.sleep_h).toBe(5.5);
  });
  it("hapus log", async () => {
    const [first] = await store.listLogs({ limit: 1 });
    await store.deleteLog(first.id);
    expect(await store.getLog(first.id)).toBeNull();
  });
});

describe("validasi skema", () => {
  it("menolak RPE 11, HR 300, session_key salah", () => {
    expect(workoutLogSchema.safeParse({ ...base, rpe: 11 }).success).toBe(false);
    expect(workoutLogSchema.safeParse({ ...base, avg_hr: 300 }).success).toBe(false);
    expect(workoutLogSchema.safeParse({ ...base, session_key: "minggu-1" }).success).toBe(false);
  });
});
