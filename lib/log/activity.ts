// Aktivitas hasil parse file (FIT/GPX/TCX) + ringkasan metrik. Semua fungsi murni.
import type { Rep, Streams, ZoneSeconds } from "./schema";

export interface Sample {
  /** detik sejak start */
  t: number;
  /** jarak kumulatif (m) */
  d: number | null;
  hr: number | null;
  /** langkah/menit (kedua kaki) setelah normalisasi */
  cad: number | null;
}

export interface Lap {
  start_s: number;
  duration_s: number;
  distance_m: number | null;
}

export interface ParsedActivity {
  format: "fit" | "gpx" | "tcx";
  start: string; // ISO UTC
  device: string | null;
  samples: Sample[];
  laps: Lap[];
  /** total dari file (bila ada), fallback dari samples */
  distance_m: number | null;
  duration_s: number | null;
  warnings: string[];
}

// ------------------------------------------------------------------ util
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Banyak format menyimpan cadence per-kaki (FIT/TCX/Strava GPX ≈ 75–100).
 * Lari normal 150–200 spm → bila median < 120, kalikan 2.
 */
export function normalizeCadence(samples: Sample[]): { samples: Sample[]; doubled: boolean } {
  const med = median(samples.map((s) => s.cad).filter((c): c is number => c != null && c > 0));
  if (med == null || med >= 120) return { samples, doubled: false };
  return { samples: samples.map((s) => ({ ...s, cad: s.cad == null ? null : s.cad * 2 })), doubled: true };
}

// ------------------------------------------------------------------ zona
export function zoneOf(hr: number, lthr: number): keyof ZoneSeconds {
  const pct = (hr / lthr) * 100;
  if (pct < 85) return "Z1";
  if (pct < 90) return "Z2";
  if (pct < 95) return "Z3";
  if (pct <= 100) return "Z4";
  return "Z5";
}

/** Detik di tiap zona (time-weighted; gap >30 dtk tidak dihitung). */
export function timeInZone(samples: Sample[], lthr: number, from = 0, to = Infinity): ZoneSeconds {
  const out: ZoneSeconds = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.hr == null || a.t < from || a.t >= to) continue;
    const dt = Math.min(b.t, to) - a.t;
    if (dt <= 0 || dt > 30) continue;
    out[zoneOf(a.hr, lthr)] += dt;
  }
  return out;
}

/** Rata-rata HR time-weighted di [from, to). */
export function avgHr(samples: Sample[], from = 0, to = Infinity): number | null {
  let sum = 0;
  let w = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    if (a.hr == null || a.t < from || a.t >= to) continue;
    const dt = Math.min(samples[i].t, to) - a.t;
    if (dt <= 0 || dt > 30) continue;
    sum += a.hr * dt;
    w += dt;
  }
  return w ? Math.round(sum / w) : null;
}

export function maxHr(samples: Sample[], from = 0, to = Infinity): number | null {
  let m: number | null = null;
  for (const s of samples) if (s.hr != null && s.t >= from && s.t < to) m = m == null ? s.hr : Math.max(m, s.hr);
  return m;
}

function valueAt(samples: Sample[], t: number, key: "hr" | "d"): number | null {
  let best: Sample | null = null;
  for (const s of samples) {
    if (s[key] == null) continue;
    if (!best || Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
  }
  return best && Math.abs(best.t - t) <= 10 ? (best[key] as number) : null;
}

// ------------------------------------------------------------------ deteksi rep
/**
 * Deteksi rep dari stream kecepatan: bagian yang lebih cepat dari ambang
 * (tengah antara pace kerja dan pace recovery), dihaluskan 15 dtk,
 * celah <20 dtk digabung, durasi minimal 40 dtk.
 */
export function detectReps(
  samples: Sample[],
  opts: { expected: number; thresholdPace_s: number; repDistance_m?: number | null; repDuration_s?: number | null },
): Array<{ start_s: number; end_s: number }> {
  const pts = samples.filter((s) => s.d != null) as Array<Sample & { d: number }>;
  if (pts.length < 3) return [];
  const thrSpeed = 1000 / opts.thresholdPace_s; // m/s
  const W = 15;
  // kecepatan rata-rata jendela [t-W/2, t+W/2] dengan dua pointer (O(n))
  let j0 = 0;
  let j1 = 0;
  const fast: boolean[] = pts.map((p) => {
    while (pts[j0].t < p.t - W / 2) j0++;
    while (j1 + 1 < pts.length && pts[j1 + 1].t <= p.t + W / 2) j1++;
    const dt = pts[j1].t - pts[j0].t;
    return dt > 0 && (pts[j1].d - pts[j0].d) / dt >= thrSpeed;
  });
  let segs: Array<{ start_s: number; end_s: number }> = [];
  let cur: { start_s: number; end_s: number } | null = null;
  pts.forEach((p, i) => {
    if (fast[i]) {
      if (!cur) cur = { start_s: p.t, end_s: p.t };
      else cur.end_s = p.t;
    } else if (cur) {
      segs.push(cur);
      cur = null;
    }
  });
  if (cur) segs.push(cur);
  // gabung celah pendek
  const merged: typeof segs = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && s.start_s - last.end_s < 20) last.end_s = s.end_s;
    else merged.push({ ...s });
  }
  segs = merged.filter((s) => s.end_s - s.start_s >= 40);
  // ambil yang terpanjang bila lebih dari yang diharapkan, tetap urut waktu
  if (segs.length > opts.expected) {
    const keep = new Set(
      [...segs].sort((a, b) => b.end_s - b.start_s - (a.end_s - a.start_s)).slice(0, opts.expected),
    );
    segs = segs.filter((s) => keep.has(s));
  }
  return segs;
}

export function repMetrics(
  samples: Sample[],
  segs: Array<{ start_s: number; end_s: number }>,
  planned: { distance_m?: number | null; duration_s?: number | null },
): Rep[] {
  return segs.map((s, i) => {
    const d0 = valueAt(samples, s.start_s, "d");
    const d1 = valueAt(samples, s.end_s, "d");
    const dist = d0 != null && d1 != null ? Math.round(d1 - d0) : null;
    const dur = Math.round(s.end_s - s.start_s);
    // HR puncak 15 dtk terakhir rep (tepi deteksi bisa meleset beberapa detik ke recovery)
    const hrEnd = maxHr(samples, s.end_s - 15, s.end_s + 1);
    const hr60 = valueAt(samples, s.end_s + 60, "hr");
    const completed =
      planned.distance_m && dist != null ? dist >= planned.distance_m * 0.95
        : planned.duration_s ? dur >= planned.duration_s * 0.95 : true;
    return {
      index: i + 1,
      distance_m: dist,
      duration_s: dur,
      pace_s: dist ? Math.round(dur / (dist / 1000)) : null,
      avg_hr: avgHr(samples, s.start_s, s.end_s),
      max_hr: maxHr(samples, s.start_s, s.end_s + 1),
      hr_drop_60s: hrEnd != null && hr60 != null ? hrEnd - hr60 : null,
      completed,
      stop_reason: null,
      stop_at_s: completed ? null : dur,
    };
  });
}

// ------------------------------------------------------------------ ringkasan
export interface ActivitySummary {
  date_utc_start: string;
  distance_m: number;
  duration_s: number;
  avg_hr: number | null;
  max_hr: number | null;
  avg_cadence: number | null;
  time_in_zone: ZoneSeconds | null;
  streams: Streams;
}

export function summarize(act: ParsedActivity, lthr: number): ActivitySummary {
  const s = act.samples;
  const last = s[s.length - 1];
  const distance = act.distance_m ?? last?.d ?? 0;
  const duration = act.duration_s ?? last?.t ?? 0;
  const cads = s.map((x) => x.cad).filter((c): c is number => c != null && c > 0);
  const hasHr = s.some((x) => x.hr != null);
  return {
    date_utc_start: act.start,
    distance_m: Math.round(distance),
    duration_s: Math.round(duration),
    avg_hr: avgHr(s),
    max_hr: maxHr(s),
    avg_cadence: cads.length ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null,
    time_in_zone: hasHr ? timeInZone(s, lthr) : null,
    streams: downsample(s, 5),
  };
}

/** Stream ringkas: ambil sampel pertama di tiap bucket `step` detik. */
export function downsample(samples: Sample[], step: number): Streams {
  const out: Streams = { t: [], hr: [], d: [], cad: [] };
  let next = -Infinity;
  for (const p of samples) {
    if (p.t < next) continue;
    out.t.push(Math.round(p.t));
    out.hr.push(p.hr);
    out.d.push(p.d == null ? null : Math.round(p.d));
    out.cad.push(p.cad);
    next = p.t + step;
  }
  return out;
}

/** Isi jarak kumulatif dari koordinat bila file tidak punya jarak (GPX). */
export function fillDistanceFromCoords(
  pts: Array<{ t: number; lat: number | null; lon: number | null }>,
): Array<number | null> {
  let acc = 0;
  let prev: { lat: number; lon: number } | null = null;
  return pts.map((p) => {
    if (p.lat == null || p.lon == null) return prev ? acc : null;
    if (prev) acc += haversine(prev.lat, prev.lon, p.lat, p.lon);
    prev = { lat: p.lat, lon: p.lon };
    return acc;
  });
}
