import { describe, expect, it } from "vitest";
import { formatRaceTime, parsePaceText, parseRaceTimeFor } from "./time";

describe("waktu race", () => {
  it("1:45 = 1 jam 45 menit untuk HM, 25:30 = 25 menit untuk 5K", () => {
    expect(parseRaceTimeFor("hm", "1:45")).toBe(6300);
    expect(parseRaceTimeFor("fm", "3.30")).toBe(12600);
    expect(parseRaceTimeFor("5k", "25:30")).toBe(1530);
    expect(parseRaceTimeFor("10k", "0:52:10")).toBe(3130);
    expect(parseRaceTimeFor("hm", "1:75")).toBeNull();
    expect(formatRaceTime(12600)).toBe("3:30:00");
    expect(parsePaceText("6:05")).toBe(365);
  });
});
