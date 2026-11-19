// Format & parse waktu race (h:mm:ss / mm:ss).
export function formatRaceTime(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}

export function parseRaceTime(text: string): number | null {
  const t = text.trim().replace(/[.,]/g, ":");
  if (!/^\d{1,2}(:\d{1,2}){1,2}$/.test(t)) return null;
  const parts = t.split(":").map(Number);
  if (parts.slice(1).some((p) => p > 59)) return null;
  const sec = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  return sec > 0 ? sec : null;
}

/**
 * Waktu race sesuai jarak: "1:45" untuk HM/FM berarti 1 jam 45 menit; untuk 5K/10K "25:30" berarti
 * 25 menit 30 detik. Tiga bagian (h:mm:ss) selalu jelas.
 */
export function parseRaceTimeFor(distance: "5k" | "10k" | "hm" | "fm", text: string): number | null {
  const t = text.trim().replace(/[.,]/g, ":");
  if (!/^\d{1,2}(:\d{1,2}){1,2}$/.test(t)) return null;
  const p = t.split(":").map(Number);
  if (p.slice(1).some((x) => x > 59)) return null;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2] || null;
  const long = distance === "hm" || distance === "fm";
  return (long ? p[0] * 3600 + p[1] * 60 : p[0] * 60 + p[1]) || null;
}

export function parsePaceText(text: string): number | null {
  const m = text.trim().replace(/[.,]/g, ":").match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
