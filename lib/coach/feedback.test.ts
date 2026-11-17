import { describe, expect, it } from "vitest";
import { feedbackForLog, splitAnalysis } from "./feedback";
import { CUES_HR170 } from "@/lib/engine/analysis";
import { STOP_MESSAGE } from "@/lib/log/safety";
import { mkLog, mkState } from "@/test/engine-fixtures";

// W07: Rabu 2027-01-06 easy + strides, Kamis 2027-01-07 tempo
const TODAY = "2027-01-08";
const text = (fb: ReturnType<typeof feedbackForLog>) => fb.points.map((p) => p.text).join(" | ");

describe("coach aturan: easy run", () => {
  it("HR di atas Z2 → peringatan pelankan", () => {
    const log = mkLog({ date: "2027-01-06", session_key: "W07-wed", avg_hr: 160, duration_s: 3000, distance_m: 8500 });
    const fb = feedbackForLog(log, mkState({ today: TODAY, logs: [log] }));
    expect(fb.tone).toBe("warn");
    expect(text(fb)).toMatch(/HR rata-rata 160 di atas batas Z2/);
  });

  it("pace terlalu cepat untuk easy → peringatan", () => {
    const log = mkLog({ date: "2027-01-06", session_key: "W07-wed", distance_m: 8000, duration_s: 8 * 320, avg_hr: 140 });
    expect(text(feedbackForLog(log, mkState({ today: TODAY, logs: [log] })))).toMatch(/Terlalu cepat/);
  });

  it("easy sesuai target → poin positif, tidak ada peringatan", () => {
    const log = mkLog({ date: "2027-01-06", session_key: "W07-wed", distance_m: 8000, duration_s: 8 * 370, avg_hr: 140, avg_cadence: 172 });
    const fb = feedbackForLog(log, mkState({ today: TODAY, logs: [log] }));
    expect(fb.tone).toBe("good");
    expect(fb.points.every((p) => p.tone !== "warn")).toBe(true);
  });

  it("Aerobic TE ≥4 untuk easy → peringatan beban", () => {
    const log = mkLog({ date: "2027-01-06", session_key: "W07-wed", distance_m: 8000, duration_s: 8 * 370, avg_hr: 140, aerobic_te: 4.3 });
    expect(text(feedbackForLog(log, mkState({ today: TODAY, logs: [log] })))).toMatch(/Aerobic TE 4,3/);
  });

  it("HR = kadens di jam → HR tidak dinilai (cadence lock)", () => {
    const log = mkLog({ date: "2027-01-06", session_key: "W07-wed", avg_hr: 172, avg_cadence: 172, hr_source: "wrist" });
    const t = text(feedbackForLog(log, mkState({ today: TODAY, logs: [log] })));
    expect(t).toMatch(/tidak akurat/);
    expect(t).not.toMatch(/di atas batas Z2/);
  });

  it("kadens <165 → saran 170–180", () => {
    const log = mkLog({ date: "2027-01-06", session_key: "W07-wed", avg_cadence: 158 });
    expect(text(feedbackForLog(log, mkState({ today: TODAY, logs: [log] })))).toMatch(/Kadens 158/);
  });
});

describe("coach aturan: tempo & HR 170", () => {
  it("rep berhenti karena HR tidak nyaman → normal di threshold + 3 cue protokol", () => {
    const log = mkLog({
      date: "2027-01-07", session_key: "W07-thu", rpe: 8, avg_hr: 162,
      discomfort_at_hr: { flag: true, bpm: 170 }, rep_incomplete: true,
      reps: [
        { index: 1, pace_s: 295, avg_hr: 166, completed: true },
        { index: 2, pace_s: 300, avg_hr: 171, completed: false, stop_reason: "hr_tidak_nyaman", stop_at_s: 360 },
      ],
    });
    const fb = feedbackForLog(log, mkState({ today: TODAY, logs: [log] }));
    expect(text(fb)).toMatch(/Rep selesai 1\/2/);
    expect(text(fb)).toMatch(/normal di ambang laktat/);
    expect(fb.cues).toEqual([CUES_HR170[0], CUES_HR170[1], CUES_HR170[4]]);
    expect(fb.cues.length).toBeLessThanOrEqual(3);
  });

  it("menit Z4 dari zona HR dibandingkan dengan rencana", () => {
    const log = mkLog({
      date: "2027-01-07", session_key: "W07-thu", rpe: 7,
      time_in_zone: { Z1: 600, Z2: 900, Z3: 300, Z4: 1200, Z5: 0 },
    });
    expect(text(feedbackForLog(log, mkState({ today: TODAY, logs: [log] })))).toMatch(/Menit Z4: 20 dari/);
  });
});

describe("coach aturan: split per km", () => {
  const splits = (paces: number[], hrs: number[]) => paces.map((p, i) => ({ km: i + 1, distance_m: null, pace_s: p, avg_hr: hrs[i] ?? null }));

  it("cardiac drift >5% di pace sama → peringatan", () => {
    const log = mkLog({ date: "2027-01-09", hr_source: "chest", splits: splits([370, 370, 371, 370, 372, 371], [140, 141, 143, 150, 152, 154]) });
    expect(splitAnalysis(log).map((p) => p.text).join(" ")).toMatch(/Cardiac drift/);
  });

  it("negative split → positif", () => {
    const log = mkLog({ date: "2027-01-09", splits: splits([380, 378, 375, 360, 358, 355], []) });
    expect(splitAnalysis(log)[0]).toMatchObject({ tone: "good" });
    expect(splitAnalysis(log)[0].text).toMatch(/Negative split/);
  });

  it("<4 split → tidak dianalisis", () => {
    expect(splitAnalysis(mkLog({ date: "2027-01-09", splits: splits([370, 371], []) }))).toEqual([]);
  });
});

describe("coach aturan: keselamatan", () => {
  it("log red flag → hanya STOP, tanpa saran latihan", () => {
    const log = mkLog({ date: "2027-01-07", session_key: "W07-thu", notes: "rep 2 nyeri dada" });
    const fb = feedbackForLog(log, mkState({ today: TODAY, logs: [log] }));
    expect(fb.tone).toBe("stop");
    expect(fb.points).toEqual([{ tone: "stop", text: STOP_MESSAGE }]);
    expect(fb.cues).toEqual([]);
    expect(fb.next).toBeNull();
  });

  it("nyeri ≥4 → peringatan tunda sesi kualitas", () => {
    const log = mkLog({ date: "2027-01-06", session_key: "W07-wed", pain: { score: 5, location: "betis", sharp: false } });
    expect(text(feedbackForLog(log, mkState({ today: TODAY, logs: [log] })))).toMatch(/Nyeri tercatat/);
  });
});
