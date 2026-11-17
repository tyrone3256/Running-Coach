// Utilitas tanggal. Semua tanggal sesi = tanggal lokal Asia/Jakarta (YYYY-MM-DD).
export const TZ = "Asia/Jakarta";

export type AnyDayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const KEYS: AnyDayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export const DAY_LABEL: Record<AnyDayKey, string> = {
  mon: "Senin", tue: "Selasa", wed: "Rabu", thu: "Kamis", fri: "Jumat", sat: "Sabtu", sun: "Minggu",
};

export function todayIso(now: Date = new Date()): string {
  // en-CA → YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}

function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isValidIso(iso: string | undefined): iso is string {
  return !!iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(parse(iso).getTime());
}

export function addDays(iso: string, n: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayKey(iso: string): AnyDayKey {
  return KEYS[parse(iso).getUTCDay()];
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}

export function formatDateId(iso: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long", ...opts,
  }).format(parse(iso));
}
