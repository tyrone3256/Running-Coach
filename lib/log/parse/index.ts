// Parser file aktivitas → ParsedActivity. Dipakai di server (API /api/import).
import { XMLParser } from "fast-xml-parser";
import { Decoder, Stream } from "@garmin/fitsdk";
import {
  fillDistanceFromCoords, normalizeCadence, type Lap, type ParsedActivity, type Sample,
} from "../activity";

export class ParseError extends Error {}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: true,
  isArray: (name) => ["trk", "trkseg", "trkpt", "Lap", "Trackpoint", "Activity", "Track"].includes(name),
});

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function finish(
  format: ParsedActivity["format"],
  raw: Array<{ time: number; d: number | null; hr: number | null; cad: number | null }>,
  laps: Lap[],
  extra: Partial<ParsedActivity>,
): ParsedActivity {
  if (!raw.length) throw new ParseError("File tidak berisi titik data (trackpoint/record).");
  raw.sort((a, b) => a.time - b.time);
  const t0 = raw[0].time;
  const warnings: string[] = [...(extra.warnings ?? [])];
  let samples: Sample[] = raw.map((r) => ({ t: (r.time - t0) / 1000, d: r.d, hr: r.hr, cad: r.cad }));
  const norm = normalizeCadence(samples);
  samples = norm.samples;
  if (norm.doubled) warnings.push("Cadence di file per-kaki → dikali 2 (langkah/menit).");
  if (!samples.some((s) => s.hr != null)) warnings.push("File tidak berisi data HR.");
  if (!samples.some((s) => s.d != null)) warnings.push("File tidak berisi jarak/GPS.");
  return {
    format,
    start: new Date(t0).toISOString(),
    device: extra.device ?? null,
    samples,
    laps: laps.map((l) => ({ ...l, start_s: Math.max(0, l.start_s - t0 / 1000) })),
    distance_m: extra.distance_m ?? samples[samples.length - 1].d,
    duration_s: extra.duration_s ?? samples[samples.length - 1].t,
    warnings,
  };
}

// ------------------------------------------------------------------ GPX
export function parseGpx(text: string): ParsedActivity {
  const doc = xml.parse(text);
  const gpx = doc.gpx;
  if (!gpx) throw new ParseError("Bukan file GPX.");
  const pts: Array<{ time: number; lat: number | null; lon: number | null; hr: number | null; cad: number | null }> = [];
  for (const trk of gpx.trk ?? []) {
    for (const seg of trk.trkseg ?? []) {
      for (const p of seg.trkpt ?? []) {
        const time = Date.parse(p.time);
        if (Number.isNaN(time)) continue;
        const ext = p.extensions?.TrackPointExtension ?? p.extensions ?? {};
        pts.push({
          time,
          lat: num(p["@lat"]),
          lon: num(p["@lon"]),
          hr: num(ext.hr ?? ext.heartrate),
          cad: num(ext.cad ?? ext.cadence),
        });
      }
    }
  }
  pts.sort((a, b) => a.time - b.time);
  const t0 = pts[0]?.time ?? 0;
  const d = fillDistanceFromCoords(pts.map((p) => ({ t: (p.time - t0) / 1000, lat: p.lat, lon: p.lon })));
  return finish(
    "gpx",
    pts.map((p, i) => ({ time: p.time, d: d[i], hr: p.hr, cad: p.cad })),
    [],
    { device: typeof gpx["@creator"] === "string" ? gpx["@creator"] : null },
  );
}

// ------------------------------------------------------------------ TCX
export function parseTcx(text: string): ParsedActivity {
  const doc = xml.parse(text);
  const act = doc.TrainingCenterDatabase?.Activities?.Activity?.[0];
  if (!act) throw new ParseError("Bukan file TCX (Activity tidak ditemukan).");
  const raw: Array<{ time: number; d: number | null; hr: number | null; cad: number | null }> = [];
  const coords: Array<{ t: number; lat: number | null; lon: number | null }> = [];
  const laps: Lap[] = [];
  let totalTime = 0;
  let totalDist = 0;
  for (const lap of act.Lap ?? []) {
    const start = Date.parse(lap["@StartTime"]);
    const dur = num(lap.TotalTimeSeconds) ?? 0;
    const dist = num(lap.DistanceMeters);
    totalTime += dur;
    totalDist += dist ?? 0;
    if (!Number.isNaN(start)) laps.push({ start_s: start / 1000, duration_s: dur, distance_m: dist });
    for (const track of lap.Track ?? []) {
      for (const tp of track.Trackpoint ?? []) {
        const time = Date.parse(tp.Time);
        if (Number.isNaN(time)) continue;
        const tpx = tp.Extensions?.TPX ?? {};
        raw.push({
          time,
          d: num(tp.DistanceMeters),
          hr: num(tp.HeartRateBpm?.Value),
          cad: num(tpx.RunCadence ?? tp.Cadence),
        });
        coords.push({ t: time, lat: num(tp.Position?.LatitudeDegrees), lon: num(tp.Position?.LongitudeDegrees) });
      }
    }
  }
  if (raw.length && raw.every((r) => r.d == null)) {
    const d = fillDistanceFromCoords(coords);
    raw.forEach((r, i) => (r.d = d[i]));
  }
  return finish("tcx", raw, laps, {
    device: act.Creator?.Name ? String(act.Creator.Name) : null,
    duration_s: totalTime || undefined,
    distance_m: totalDist || undefined,
  });
}

// ------------------------------------------------------------------ FIT
export function parseFit(bytes: Uint8Array): ParsedActivity {
  const stream = Stream.fromByteArray(Array.from(bytes));
  if (!Decoder.isFIT(stream)) throw new ParseError("Bukan file FIT.");
  const decoder = new Decoder(stream);
  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true, expandComponents: true, convertDateTimesToDates: true, mergeHeartRates: true,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = messages as Record<string, any[] | undefined>;
  const records = m.recordMesgs ?? [];
  const raw = records
    .filter((r) => r.timestamp instanceof Date)
    .map((r) => ({
      time: (r.timestamp as Date).getTime(),
      d: num(r.distance),
      hr: num(r.heartRate),
      cad: r.cadence == null ? null : (num(r.cadence) ?? 0) + (num(r.fractionalCadence) ?? 0),
    }));
  const laps: Lap[] = (m.lapMesgs ?? [])
    .filter((l) => l.startTime instanceof Date)
    .map((l) => ({
      start_s: (l.startTime as Date).getTime() / 1000,
      duration_s: num(l.totalTimerTime) ?? num(l.totalElapsedTime) ?? 0,
      distance_m: num(l.totalDistance),
    }));
  const session = m.sessionMesgs?.[0];
  const fileId = m.fileIdMesgs?.[0];
  return finish("fit", raw, laps, {
    device: fileId ? [fileId.manufacturer, fileId.garminProduct ?? fileId.product].filter(Boolean).join(" ") : null,
    duration_s: num(session?.totalTimerTime) ?? undefined,
    distance_m: num(session?.totalDistance) ?? undefined,
    warnings: errors.length ? [`FIT: ${errors.length} error saat decode (data parsial dipakai).`] : [],
  });
}

// ------------------------------------------------------------------ dispatch
export function parseActivityFile(name: string, bytes: Uint8Array): ParsedActivity {
  const ext = name.toLowerCase().split(".").pop();
  const head = new TextDecoder().decode(bytes.slice(0, 512));
  if (ext === "fit" || (bytes.length > 12 && head.slice(8, 12) === ".FIT")) return parseFit(bytes);
  const text = new TextDecoder().decode(bytes);
  if (ext === "gpx" || /<gpx[\s>]/.test(head)) return parseGpx(text);
  if (ext === "tcx" || /<TrainingCenterDatabase/.test(head)) return parseTcx(text);
  throw new ParseError("Format tidak didukung. Pakai .fit, .gpx, atau .tcx.");
}
