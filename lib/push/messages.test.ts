import { describe, expect, it } from "vitest";
import { eveningMessage, morningMessage } from "./messages";
import { appliedChange, mkLog, mkState } from "@/test/engine-fixtures";

// W07: Sel 2027-01-05 easy, Kam 2027-01-07 tempo; Senin 2027-01-04 tanpa lari
describe("push: pesan pagi", () => {
  it("hari lari → nama sesi, km, durasi, pengingat check-in", () => {
    const m = morningMessage(mkState({ today: "2027-01-07" }))!;
    expect(m.title).toMatch(/Tempo/);
    expect(m.title).toMatch(/keras/);
    expect(m.body).toMatch(/km · ±\d+ menit/);
    expect(m.body).toMatch(/check-in/);
    expect(m.url).toBe("/");
  });

  it("hari tanpa lari & tidak ada pending → tidak ada notifikasi", () => {
    expect(morningMessage(mkState({ today: "2027-01-04" }))).toBeNull();
  });

  it("hari tanpa lari tapi ada perubahan pending → ke halaman perubahan", () => {
    const st = mkState({ today: "2027-01-04", changes: [appliedChange({ rule: "R5", changes: [], date: "2027-01-03", mode: "pending" })] });
    const m = morningMessage(st)!;
    expect(m.url).toBe("/program/changes");
    expect(m.body).toMatch(/1 perubahan/);
  });

  it("hold red flag → hanya pengingat dokter, tanpa sesi latihan", () => {
    const st = mkState({ today: "2027-01-07", logs: [mkLog({ date: "2027-01-06", notes: "nyeri dada saat rep" })] });
    const m = morningMessage(st)!;
    expect(m.title).toMatch(/ditahan/);
    expect(m.body).toMatch(/dokter/);
    expect(m.body).not.toMatch(/Tempo/);
  });

  it("sebelum program mulai → tidak ada notifikasi", () => {
    expect(morningMessage(mkState({ today: "2026-11-18" }))).toBeNull();
  });
});

describe("push: pesan sore", () => {
  it("sesi hari ini belum dilog → pengingat dengan link log sesi itu", () => {
    const m = eveningMessage(mkState({ today: "2027-01-07" }))!;
    expect(m.url).toBe("/log/new?session=W07-thu&date=2027-01-07");
  });

  it("sudah ada log hari ini → diam", () => {
    expect(eveningMessage(mkState({ today: "2027-01-07", logs: [mkLog({ date: "2027-01-07", session_key: "W07-thu" })] }))).toBeNull();
  });

  it("hold aktif → diam (tidak mendorong latihan)", () => {
    const st = mkState({ today: "2027-01-07", logs: [mkLog({ date: "2027-01-06", red_flags: ["chest_pain"] as never })] });
    expect(eveningMessage(st)).toBeNull();
  });
});
