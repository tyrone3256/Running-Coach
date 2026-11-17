// Resolver pace & HR — fungsi murni. Pace absolut TIDAK pernah disimpan di sesi;
// selalu dihitung dari pace profile + LTHR aktif.
import type {
  HrZoneTag, PacedCode, PaceProfile, PaceRange, Segment, Session, ZoneName,
} from "./types";

export const HR_ZONES_PCT: Record<ZoneName, [number, number]> = {
  Z1: [0, 84],
  Z2: [85, 89],
  Z3: [90, 94],
  Z4: [95, 100],
  Z5: [101, 106],
};

const PACED = new Set<string>(["WU", "E", "REC", "L", "M", "H", "T", "N", "JOG", "TJOG", "S"]);

export function isPaced(code: string): code is PacedCode {
  return PACED.has(code);
}

export function isBaseWeek(profile: PaceProfile, week: number): boolean {
  const [a, b] = profile.base_phase.weeks;
  return week >= a && week <= b;
}

/** Rentang pace kode untuk minggu tertentu (varian fase Base bila berlaku). */
export function codePace(
  profile: PaceProfile, code: PacedCode, week: number, variant?: "base",
): PaceRange {
  const override = profile.base_phase[code];
  if (override && (variant === "base" || isBaseWeek(profile, week))) return override;
  return profile.default[code];
}

/** Pace segmen (detik/km) atau null untuk segmen effort-based (HILL/TEST). */
export function resolvePace(seg: Segment, profile: PaceProfile, week: number): PaceRange | null {
  if (!isPaced(seg.intensity)) return null;
  const [lo, hi] = codePace(profile, seg.intensity, week, seg.pace_variant);
  const [a, b] = seg.pace_adj_s ?? [0, 0];
  return [lo + a, hi + b];
}

export function formatPace(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatPaceRange(r: PaceRange | null): string {
  if (!r) return "effort";
  return r[0] === r[1] ? formatPace(r[0]) : `${formatPace(r[0])}–${formatPace(r[1])}`;
}

/** "Z1-2" → ["Z1","Z2"]; "Z4" → ["Z4","Z4"] */
export function parseZoneTag(tag: HrZoneTag): [ZoneName, ZoneName] {
  const m = /^Z(\d)(?:[-–](\d))?$/.exec(tag.trim());
  if (!m) throw new Error(`Tag zona tidak valid: ${tag}`);
  const a = `Z${m[1]}` as ZoneName;
  const b = `Z${m[2] ?? m[1]}` as ZoneName;
  if (!(a in HR_ZONES_PCT) || !(b in HR_ZONES_PCT)) throw new Error(`Zona di luar Z1–Z5: ${tag}`);
  return [a, b];
}

/** bpm [bawah, atas]; bawah = null bila zona mulai dari Z1 (tampil "≤ atas"). */
export function resolveHr(tag: HrZoneTag | null, lthr: number): [number | null, number] | null {
  if (!tag) return null;
  const [a, b] = parseZoneTag(tag);
  const lo = HR_ZONES_PCT[a][0];
  const hi = HR_ZONES_PCT[b][1];
  return [lo === 0 ? null : Math.round((lthr * lo) / 100), Math.round((lthr * hi) / 100)];
}

export function formatHr(r: [number | null, number] | null): string {
  if (!r) return "—";
  return r[0] === null ? `≤${r[1]} bpm` : `${r[0]}–${r[1]} bpm`;
}

export function zoneTable(lthr: number) {
  return (Object.keys(HR_ZONES_PCT) as ZoneName[]).map((z) => ({
    zone: z,
    pct: HR_ZONES_PCT[z],
    bpm: resolveHr(z, lthr)!,
  }));
}

/** Total km segmen (reps × jarak). */
export function segmentKm(seg: Segment): number {
  if (!seg.distance_m) return 0;
  return (seg.distance_m * (seg.reps ?? 1)) / 1000;
}

/** Perkiraan menit Z4 terencana (segmen kerja T/H yang tag zonanya memuat Z4), di pace tengah. */
export function plannedZ4Minutes(session: Session, profile: PaceProfile): number {
  let total = 0;
  for (const seg of session.segments) {
    if (seg.kind !== "work" || !seg.hr_zone) continue;
    if (seg.intensity !== "T" && seg.intensity !== "H") continue;
    const [a, b] = parseZoneTag(seg.hr_zone);
    if (!(a <= "Z4" && b >= "Z4")) continue;
    if (seg.duration_s && !seg.distance_m) {
      total += (seg.duration_s * (seg.reps ?? 1)) / 60;
      continue;
    }
    const p = resolvePace(seg, profile, session.week)!;
    total += (((p[0] + p[1]) / 2) * segmentKm(seg)) / 60;
  }
  return Math.round(total * 10) / 10;
}

/** Perkiraan durasi sesi (menit) di pace tengah; segmen effort-based pakai durasi bila ada. */
export function estimateDurationMin(session: Session, profile: PaceProfile): number {
  let sec = 0;
  for (const seg of session.segments) {
    const p = resolvePace(seg, profile, session.week);
    if (p && seg.distance_m) sec += ((p[0] + p[1]) / 2) * segmentKm(seg);
    else if (seg.duration_s) sec += seg.duration_s * (seg.reps ?? 1);
  }
  return Math.round(sec / 60);
}
