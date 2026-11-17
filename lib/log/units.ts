// Konversi input manusia ↔ angka.

/** "45:30" → 2730, "1:05:30" → 3930, "45" → 2700 (menit). null bila tidak valid. */
export function parseDuration(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d+(?:[.,]\d+)?$/.test(t)) return Math.round(parseFloat(t.replace(",", ".")) * 60);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const [h, mi, s] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (s >= 60 || (m[1] && mi >= 60)) return null;
  return h * 3600 + mi * 60 + s;
}

export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** "5:30" → 330 detik/km */
export function parsePace(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m || Number(m[2]) >= 60) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "10,5" / "10.5" → 10500 m */
export function parseKm(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 1000);
}

export function paceOf(distance_m: number, duration_s: number): number | null {
  return distance_m > 0 ? Math.round(duration_s / (distance_m / 1000)) : null;
}
