import { describe, expect, it } from "vitest";
import { Encoder, Profile } from "@garmin/fitsdk";
import { parseActivityFile, parseFit, parseGpx, parseTcx, ParseError } from "./index";
import { summarize } from "../activity";

const START = Date.UTC(2026, 11, 22, 23, 0, 0); // 06:00 WIB, Selasa 23 Des 2026
const N = 600; // 10 menit, 1 Hz
const PACE = 360; // 6:00/km → 1000/360 m/s
const LAT0 = -6.3;
const LON0 = 106.65;
const DEG_PER_M = 1 / 111_195; // ke arah utara

function gpx(): string {
  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const lat = LAT0 + (i * 1000) / PACE * DEG_PER_M;
    const time = new Date(START + i * 1000).toISOString();
    return `<trkpt lat="${lat.toFixed(7)}" lon="${LON0}"><ele>20</ele><time>${time}</time>
      <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${145 + (i % 5)}</gpxtpx:hr><gpxtpx:cad>86</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0"?><gpx creator="Huawei Health" version="1.1"
    xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>Lari</name><trkseg>${pts}</trkseg></trk></gpx>`;
}

function tcx(): string {
  const tps = Array.from({ length: N + 1 }, (_, i) => `<Trackpoint><Time>${new Date(START + i * 1000).toISOString()}</Time>
    <DistanceMeters>${((i * 1000) / PACE).toFixed(1)}</DistanceMeters><HeartRateBpm><Value>150</Value></HeartRateBpm>
    <Extensions><ns3:TPX><ns3:RunCadence>88</ns3:RunCadence></ns3:TPX></Extensions></Trackpoint>`).join("\n");
  return `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
    xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><Activities><Activity Sport="Running">
    <Id>${new Date(START).toISOString()}</Id>
    <Lap StartTime="${new Date(START).toISOString()}"><TotalTimeSeconds>300</TotalTimeSeconds><DistanceMeters>833.3</DistanceMeters><Track>${tps}</Track></Lap>
    <Lap StartTime="${new Date(START + 300_000).toISOString()}"><TotalTimeSeconds>300</TotalTimeSeconds><DistanceMeters>833.4</DistanceMeters></Lap>
    <Creator><Name>HUAWEI WATCH</Name></Creator></Activity></Activities></TrainingCenterDatabase>`;
}

// Tipe Mesg SDK terlalu sempit untuk objek literal; isi tetap divalidasi Encoder saat runtime.
const M = (o: Record<string, unknown>) => o as never;

function fit(): Uint8Array {
  const enc = new Encoder();
  enc.onMesg(Profile.MesgNum.FILE_ID, M({
    manufacturer: "development", product: 1, timeCreated: new Date(START), type: "activity",
  }));
  for (let i = 0; i <= N; i++) {
    enc.onMesg(Profile.MesgNum.RECORD, M({
      timestamp: new Date(START + i * 1000),
      distance: (i * 1000) / PACE,
      heartRate: i < 300 ? 140 : 165,
      cadence: 87,
    }));
  }
  enc.onMesg(Profile.MesgNum.LAP, M({
    timestamp: new Date(START + N * 1000), startTime: new Date(START),
    totalTimerTime: N, totalElapsedTime: N, totalDistance: (N * 1000) / PACE,
  }));
  enc.onMesg(Profile.MesgNum.SESSION, M({
    timestamp: new Date(START + N * 1000), startTime: new Date(START), sport: "running",
    totalTimerTime: N, totalElapsedTime: N, totalDistance: (N * 1000) / PACE,
  }));
  return enc.close();
}

const DIST = (N * 1000) / PACE; // 1666,7 m

describe("parseGpx", () => {
  const a = parseGpx(gpx());
  it("jarak dari koordinat, durasi, HR, cadence ×2", () => {
    expect(a.format).toBe("gpx");
    expect(a.start).toBe(new Date(START).toISOString());
    expect(Math.abs(a.distance_m! - DIST)).toBeLessThan(15);
    expect(a.duration_s).toBe(N);
    expect(a.samples[0].hr).toBe(145);
    expect(a.samples[0].cad).toBe(172);
    expect(a.device).toBe("Huawei Health");
    expect(a.warnings.join()).toMatch(/per-kaki/);
  });
});

describe("parseTcx", () => {
  const a = parseTcx(tcx());
  it("jarak, lap, RunCadence", () => {
    expect(a.format).toBe("tcx");
    expect(Math.round(a.distance_m!)).toBe(1667);
    expect(a.duration_s).toBe(600);
    expect(a.laps).toHaveLength(2);
    expect(a.laps[1].start_s).toBe(300);
    expect(a.samples[0].cad).toBe(176);
    expect(a.device).toBe("HUAWEI WATCH");
  });
});

describe("parseFit", () => {
  const a = parseFit(fit());
  it("record, session, lap", () => {
    expect(a.format).toBe("fit");
    expect(a.start).toBe(new Date(START).toISOString());
    expect(Math.round(a.distance_m!)).toBe(Math.round(DIST));
    expect(a.duration_s).toBe(N);
    expect(a.laps).toHaveLength(1);
    expect(a.samples[0].cad).toBe(174);
  });
  it("ringkasan: avg HR & zona (LTHR 170)", () => {
    const s = summarize(a, 170);
    expect(s.avg_hr).toBe(Math.round((140 * 300 + 165 * 300) / 600));
    expect(s.time_in_zone!.Z1).toBe(300);
    expect(s.time_in_zone!.Z4).toBe(300); // 165/170 = 97% → Z4
    expect(s.avg_cadence).toBe(174);
    expect(s.streams.t.length).toBe(121);
  });
});

describe("parseActivityFile", () => {
  const enc = new TextEncoder();
  it("deteksi format dari ekstensi / isi", () => {
    expect(parseActivityFile("lari.gpx", enc.encode(gpx())).format).toBe("gpx");
    expect(parseActivityFile("export", enc.encode(tcx())).format).toBe("tcx");
    expect(parseActivityFile("x.FIT", fit()).format).toBe("fit");
  });
  it("format lain ditolak dengan pesan jelas", () => {
    expect(() => parseActivityFile("a.csv", enc.encode("a,b"))).toThrow(ParseError);
    expect(() => parseGpx("<gpx></gpx>")).toThrow(ParseError);
  });
});
