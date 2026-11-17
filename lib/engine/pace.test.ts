import { describe, expect, it } from "vitest";
import seed from "@/seed/plan.json";
import type { PaceProfile, PlanSeed, Segment } from "./types";
import {
  codePace, estimateDurationMin, formatHr, formatPace, formatPaceRange, parseZoneTag,
  plannedZ4Minutes, resolveHr, resolvePace,
} from "./pace";

const plan = seed as unknown as PlanSeed;
const profile = plan.pace_profile;
const byId = (id: string) => plan.sessions.find((s) => s.id === id)!;

describe("formatPace", () => {
  it("format mm:ss", () => {
    expect(formatPace(298)).toBe("4:58");
    expect(formatPace(360)).toBe("6:00");
    expect(formatPaceRange([350, 390])).toBe("5:50–6:30");
    expect(formatPaceRange(null)).toBe("effort");
  });
});

describe("codePace (fase-aware)", () => {
  it("T & N pakai varian Base di W03–W08", () => {
    expect(codePace(profile, "T", 4)).toEqual([298, 305]);
    expect(codePace(profile, "N", 8)).toEqual([275, 285]);
    expect(codePace(profile, "T", 9)).toEqual([288, 295]);
    expect(codePace(profile, "N", 2)).toEqual([265, 280]);
  });
  it("pace_variant=base memaksa varian Base di luar fase Base (D4)", () => {
    expect(codePace(profile, "N", 2, "base")).toEqual([275, 285]);
  });
  it("kode tanpa override tidak terpengaruh fase", () => {
    expect(codePace(profile, "E", 5)).toEqual([350, 390]);
  });
});

describe("resolvePace", () => {
  it("menerapkan pace_adj_s", () => {
    const seg: Segment = { kind: "steady", intensity: "L", hr_zone: "Z2", pace_adj_s: [10, 10] };
    expect(resolvePace(seg, profile, 6)).toEqual([355, 385]); // 5:55–6:25
  });
  it("HILL & TEST = null (effort)", () => {
    expect(resolvePace({ kind: "hill", intensity: "HILL", hr_zone: null }, profile, 15)).toBeNull();
  });
  it("ubah profil → sesi ikut berubah (tidak ada pace absolut tersimpan)", () => {
    const slower: PaceProfile = structuredClone(profile);
    slower.default.E = [360, 400];
    const wed = byId("W12-wed").segments[0];
    expect(formatPaceRange(resolvePace(wed, profile, 12))).toBe("5:50–6:30");
    expect(formatPaceRange(resolvePace(wed, slower, 12))).toBe("6:00–6:40");
  });
});

describe("seed reproduksi pace Excel", () => {
  it("setiap segmen ber-pace menghasilkan pace yang sama dengan teks Excel", () => {
    const mismatches: string[] = [];
    for (const s of plan.sessions) {
      for (const seg of s.segments) {
        if (!seg.src_pace || seg.kind === "test") continue;
        const got = resolvePace(seg, profile, s.week);
        const want = seg.src_pace.split("–").map((x) => {
          const [m, sec] = x.split(":").map(Number);
          return m * 60 + sec;
        });
        if (!got || got[0] !== want[0] || got[1] !== want[1]) {
          mismatches.push(`${s.id} ${seg.kind} ${seg.src_pace} → ${formatPaceRange(got)}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
  it("tidak ada segmen dengan kode intensitas tak dikenal", () => {
    const codes = new Set(["WU", "E", "REC", "L", "M", "H", "T", "N", "JOG", "TJOG", "S", "HILL", "TEST"]);
    for (const s of plan.sessions) for (const seg of s.segments) expect(codes).toContain(seg.intensity);
  });
});

describe("resolveHr (LTHR 170)", () => {
  it("zona sesuai sheet ⏱️", () => {
    expect(resolveHr("Z1", 170)).toEqual([null, 143]);
    expect(resolveHr("Z2", 170)).toEqual([145, 151]);
    expect(resolveHr("Z3", 170)).toEqual([153, 160]);
    expect(resolveHr("Z4", 170)).toEqual([162, 170]);
    expect(resolveHr("Z5", 170)).toEqual([172, 180]);
    expect(resolveHr("Z1-2", 170)).toEqual([null, 151]);
    expect(formatHr(resolveHr("Z4", 170))).toBe("162–170 bpm");
  });
  it("LTHR 172 → Z4 163–172", () => {
    expect(resolveHr("Z4", 172)).toEqual([163, 172]);
  });
  it("tag tidak valid ditolak", () => {
    expect(() => parseZoneTag("Z9")).toThrow();
    expect(resolveHr(null, 170)).toBeNull();
  });
});

describe("plannedZ4Minutes", () => {
  it("cocok dengan perhitungan parser", () => {
    for (const s of plan.sessions.filter((x) => x.z4_planned_min)) {
      expect(plannedZ4Minutes(s, profile)).toBeCloseTo(s.z4_planned_min!, 0);
    }
  });
  it("W07 tempo 3×2 km Base ≈ 30′ (anak tangga 30′)", () => {
    expect(plannedZ4Minutes(byId("W07-thu"), profile)).toBe(30.2);
  });
  it("durasi sesi masuk akal", () => {
    const d = estimateDurationMin(byId("W05-sat"), profile); // 18 km @ 6:00
    expect(d).toBe(108);
  });
});

describe("integritas seed", () => {
  it("27 minggu, 135 sesi, km total sesuai Excel", () => {
    expect(plan.weeks).toHaveLength(27);
    expect(plan.sessions).toHaveLength(135);
    const total = plan.weeks.reduce((a, w) => a + w.planned_km, 0);
    expect(Math.round(total * 10) / 10).toBe(1533.6);
  });
  it("W12 & W27 ditandai pengecualian guardrail yang menunggu keputusan", () => {
    const ex = plan.weeks.filter((w) => w.guardrail_exception).map((w) => w.week);
    expect(ex).toEqual([12, 27]);
  });
});
