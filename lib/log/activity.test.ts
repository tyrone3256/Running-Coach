import { describe, expect, it } from "vitest";
import {
  avgHr, detectReps, downsample, haversine, normalizeCadence, repMetrics, timeInZone, zoneOf,
  type Sample,
} from "./activity";
import { synth } from "@/test/synth";
import { parseDuration, parseKm, parsePace, formatDuration, paceOf } from "./units";
import { assessLogSafety, detectRedFlagText } from "./safety";

describe("units", () => {
  it("parseDuration", () => {
    expect(parseDuration("45:30")).toBe(2730);
    expect(parseDuration("1:05:30")).toBe(3930);
    expect(parseDuration("45")).toBe(2700);
    expect(parseDuration("4:75")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(formatDuration(3930)).toBe("1:05:30");
  });
  it("pace & km", () => {
    expect(parsePace("4:58")).toBe(298);
    expect(parseKm("10,5")).toBe(10500);
    expect(paceOf(10000, 3600)).toBe(360);
    expect(paceOf(0, 100)).toBeNull();
  });
});

describe("zona & HR", () => {
  it("zoneOf (LTHR 170)", () => {
    expect(zoneOf(143, 170)).toBe("Z1");
    expect(zoneOf(150, 170)).toBe("Z2");
    expect(zoneOf(160, 170)).toBe("Z3");
    expect(zoneOf(170, 170)).toBe("Z4");
    expect(zoneOf(171, 170)).toBe("Z5");
  });
  it("timeInZone & avgHr time-weighted", () => {
    const s = synth([[600, 360, 140], [1200, 295, 166], [300, 400, 130]]);
    const z = timeInZone(s, 170);
    expect(z.Z1).toBe(900);
    expect(z.Z4).toBe(1200);
    expect(avgHr(s)).toBe(Math.round((140 * 600 + 166 * 1200 + 130 * 300) / 2100));
  });
  it("gap >30 dtk (jam pause) tidak dihitung", () => {
    const s: Sample[] = [
      { t: 0, d: 0, hr: 150, cad: null }, { t: 10, d: 30, hr: 150, cad: null },
      { t: 200, d: 60, hr: 150, cad: null }, { t: 210, d: 90, hr: 150, cad: null },
    ];
    expect(timeInZone(s, 170).Z2).toBe(20);
  });
});

describe("cadence", () => {
  it("cadence per-kaki dikali 2", () => {
    const r = normalizeCadence(synth([[60, 360, 140]], 86));
    expect(r.doubled).toBe(true);
    expect(r.samples[0].cad).toBe(172);
  });
  it("cadence penuh dibiarkan", () => {
    expect(normalizeCadence(synth([[60, 360, 140]], 176)).doubled).toBe(false);
  });
});

describe("deteksi rep 4×4", () => {
  // WU 15′ @6:15, 4×(4′ @4:30 + 3′ jog @7:30), CD 10′
  const blocks: Array<[number, number, number]> = [[900, 375, 140]];
  for (let i = 0; i < 4; i++) {
    blocks.push([240, 270, 176]);
    if (i < 3) blocks.push([180, 450, 135]);
  }
  blocks.push([600, 375, 138]);
  const s = synth(blocks);

  it("menemukan 4 rep dengan durasi ±4′", () => {
    const segs = detectReps(s, { expected: 4, thresholdPace_s: (275 + 450) / 2 });
    expect(segs).toHaveLength(4);
    for (const g of segs) expect(Math.abs(g.end_s - g.start_s - 240)).toBeLessThanOrEqual(15);
  });
  it("metrik rep: pace ±4:30, HR 176, HR drop 60 dtk terukur", () => {
    const segs = detectReps(s, { expected: 4, thresholdPace_s: 360 });
    const reps = repMetrics(s, segs, { duration_s: 240 });
    expect(reps[0].pace_s).toBeGreaterThanOrEqual(265);
    expect(reps[0].pace_s).toBeLessThanOrEqual(275);
    // tepi rep kabur ±7 dtk (penghalusan 15 dtk) → toleransi kecil
    expect(reps[0].avg_hr).toBeGreaterThanOrEqual(174);
    expect(reps[0].hr_drop_60s).toBeGreaterThanOrEqual(35);
  });
  it("rep yang dihentikan di tengah ditandai tidak selesai", () => {
    const s2 = synth([[600, 375, 140], [600, 295, 168], [60, 450, 150], [360, 295, 172], [600, 420, 140]]);
    const segs = detectReps(s2, { expected: 2, thresholdPace_s: 360 });
    const reps = repMetrics(s2, segs, { duration_s: 600 });
    expect(reps.map((r) => r.completed)).toEqual([true, false]);
    expect(reps[1].stop_at_s).toBeGreaterThan(300);
  });
});

describe("downsample & haversine", () => {
  it("5 dtk", () => {
    const d = downsample(synth([[100, 360, 140]]), 5);
    expect(d.t.slice(0, 3)).toEqual([0, 5, 10]);
    expect(d.t.length).toBe(21);
  });
  it("haversine ±111 km per derajat lintang", () => {
    expect(Math.round(haversine(0, 0, 1, 0) / 1000)).toBe(111);
  });
});

describe("safety (dasar R10)", () => {
  const base = { red_flags: [] as never[], notes: null, pain: { score: 0, location: null, sharp: false } };
  it("'nyeri dada' di catatan → STOP", () => {
    const r = assessLogSafety({ ...base, notes: "rep 3 tiba-tiba nyeri dada, berhenti" });
    expect(r.level).toBe("stop");
    expect(r.reasons).toContain("nyeri dada");
  });
  it("checklist red flag → STOP", () => {
    expect(assessLogSafety({ ...base, red_flags: ["faint"] as never[] }).level).toBe("stop");
  });
  it("nyeri 4/10 → cek medis, bukan STOP", () => {
    expect(assessLogSafety({ ...base, pain: { score: 4, location: "betis", sharp: false } }).level)
      .toBe("medical_check");
  });
  it("'HR 170 berat' bukan red flag", () => {
    expect(detectRedFlagText("HR 170 terasa berat, napas ngos-ngosan")).toEqual([]);
    expect(assessLogSafety({ ...base, notes: "berat banget di rep 2" }).level).toBe("ok");
  });
});
