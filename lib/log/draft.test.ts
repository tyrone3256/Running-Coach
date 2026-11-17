import { describe, expect, it } from "vitest";
import seed from "@/seed/plan.json";
import type { PlanSeed } from "@/lib/engine/types";
import { buildDraft, repThreshold } from "./draft";
import { synth } from "@/test/synth";
import type { ParsedActivity } from "./activity";

const plan = seed as unknown as PlanSeed;
const session = (id: string) => plan.sessions.find((s) => s.id === id)!;

describe("repThreshold", () => {
  it("4×4 W12: antara 4:40 (kerja) dan 7:00 (jog)", () => {
    const t = repThreshold(session("W12-tue"), plan.pace_profile)!;
    expect(t.expected).toBe(4);
    expect(t.thresholdPace_s).toBe((280 + 420) / 2);
  });
  it("easy run → null (tanpa rep)", () => {
    expect(repThreshold(session("W12-wed"), plan.pace_profile)).toBeNull();
  });
});

describe("buildDraft", () => {
  // W12 Kamis tempo 3×2,5 km @4:48–4:55, jog 300 m @6:30–7:00
  const blocks: Array<[number, number, number]> = [[1080, 375, 140]];
  for (let i = 0; i < 3; i++) {
    blocks.push([730, 292, 166]);
    if (i < 2) blocks.push([100, 400, 145]);
  }
  blocks.push([750, 375, 140]);
  const act: ParsedActivity = {
    format: "fit", start: "2027-02-10T23:05:00.000Z", device: "Huawei", samples: synth(blocks, 176),
    laps: [], distance_m: null, duration_s: null, warnings: [],
  };
  const d = buildDraft(act, {
    lthr: 170, profile: plan.pace_profile, sessions: plan.sessions, fileName: "x.fit", hrSource: "wrist",
  });

  it("tanggal WIB → sesi W12 Kamis", () => {
    expect(d.log.date).toBe("2027-02-11");
    expect(d.log.session_key).toBe("W12-thu");
  });
  it("3 rep terdeteksi, semua selesai (±2,5 km)", () => {
    expect(d.reps_detected).toBe(3);
    expect(d.log.reps.every((r) => r.completed)).toBe(true);
    expect(d.log.rep_incomplete).toBe(false);
    expect(d.warnings).toEqual([]);
  });
  it("RPE dibiarkan kosong (wajib diisi user)", () => {
    expect(d.log.rpe).toBeNull();
  });
});
