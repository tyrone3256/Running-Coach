import { describe, expect, it } from "vitest";
import seed from "@/seed/plan.json";
import type { PlanSeed } from "@/lib/engine/types";
import { planToRows } from "./seed-rows";

const rows = planToRows(seed as unknown as PlanSeed, "user-1", "pv-1");

describe("planToRows", () => {
  it("semua baris milik user yang sama", () => {
    const all = [rows.athlete_profile, rows.pace_profile, rows.hr_profile, rows.plan_version,
      ...rows.plan_weeks, ...rows.sessions];
    expect(all.every((r) => r.user_id === "user-1")).toBe(true);
  });
  it("135 sesi dengan key stabil, 27 minggu", () => {
    expect(rows.sessions).toHaveLength(135);
    expect(rows.plan_weeks).toHaveLength(27);
    expect(new Set(rows.sessions.map((s) => s.key)).size).toBe(135);
  });
  it("segmen tidak menyimpan pace absolut", () => {
    for (const s of rows.sessions) {
      for (const seg of s.segments as Record<string, unknown>[]) {
        expect(seg).not.toHaveProperty("pace");
        expect(seg).not.toHaveProperty("pace_s");
      }
    }
  });
  it("LTHR awal 170 sebagai estimasi; pace profile base_phase memuat minggu", () => {
    expect(rows.hr_profile).toMatchObject({ lthr: 170, source: "estimate" });
    expect(rows.pace_profile.base_phase).toMatchObject({ weeks: [3, 8], T: [298, 305] });
  });
});
