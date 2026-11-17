// Klien Strava API v3 (OAuth, aktivitas, streams). fetch diinjeksi supaya bisa diuji tanpa jaringan.
import { normalizeCadence, type ParsedActivity, type Sample } from "@/lib/log/activity";

export const STRAVA_AUTHORIZE = "https://www.strava.com/oauth/authorize";
export const STRAVA_TOKEN = "https://www.strava.com/oauth/token";
export const STRAVA_REVOKE = "https://www.strava.com/oauth/revoke";
export const STRAVA_API = "https://www.strava.com/api/v3";
/** activity:read_all: perlu agar aktivitas "Only you" dari Huawei Health juga terbaca. */
export const STRAVA_SCOPE = "read,activity:read_all";

export type Fetch = typeof fetch;

export interface StravaConnection {
  athlete_id: number;
  athlete_name: string | null;
  access_token: string;
  refresh_token: string;
  /** epoch detik */
  expires_at: number;
  scope: string;
  last_sync_at: string | null;
}

export interface StravaActivity {
  id: number;
  name: string;
  sport_type?: string;
  type?: string;
  start_date: string; // ISO UTC
  distance: number; // m
  moving_time: number; // s
  elapsed_time: number; // s
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  has_heartrate?: boolean;
  average_cadence?: number | null;
  device_name?: string | null;
  manual?: boolean;
}

type StreamKey = "time" | "distance" | "heartrate" | "cadence" | "velocity_smooth";
export type StravaStreams = Partial<Record<StreamKey, { data: number[] }>>;

/** Dokumentasi Strava menampilkan array [{type, data}], API lama mengembalikan objek per type — terima keduanya. */
export function normalizeStreams(raw: unknown): StravaStreams {
  if (Array.isArray(raw)) {
    const out: StravaStreams = {};
    for (const s of raw as Array<{ type?: string; data?: unknown }>) {
      if (s && typeof s.type === "string" && Array.isArray(s.data)) out[s.type as StreamKey] = { data: s.data as number[] };
    }
    return out;
  }
  if (raw && typeof raw === "object") return raw as StravaStreams;
  return {};
}

export class StravaError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);
export const isRun = (a: Pick<StravaActivity, "sport_type" | "type">) => RUN_TYPES.has(a.sport_type ?? a.type ?? "");

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL(STRAVA_AUTHORIZE);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("approval_prompt", "auto");
  u.searchParams.set("scope", STRAVA_SCOPE);
  u.searchParams.set("state", state);
  return u.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string };
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new StravaError(`Strava ${what} gagal (${res.status})${body ? `: ${body.slice(0, 200)}` : ""}`, res.status);
  }
  return res.json() as Promise<T>;
}

export async function exchangeCode(
  f: Fetch, creds: { clientId: string; clientSecret: string }, code: string, scope: string,
): Promise<StravaConnection> {
  const res = await f(STRAVA_TOKEN, {
    method: "POST",
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, code, grant_type: "authorization_code" }),
  });
  const t = await json<TokenResponse>(res, "tukar kode");
  if (!t.athlete?.id) throw new StravaError("Respons token tanpa athlete", 502);
  return {
    athlete_id: t.athlete.id,
    athlete_name: [t.athlete.firstname, t.athlete.lastname].filter(Boolean).join(" ") || null,
    access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at,
    scope, last_sync_at: null,
  };
}

/** Kembalikan koneksi dengan access token valid (refresh bila <5 menit lagi kedaluwarsa). */
export async function ensureFresh(
  f: Fetch, creds: { clientId: string; clientSecret: string }, c: StravaConnection, nowSec = Math.floor(Date.now() / 1000),
): Promise<{ conn: StravaConnection; refreshed: boolean }> {
  if (c.expires_at - 300 > nowSec) return { conn: c, refreshed: false };
  const res = await f(STRAVA_TOKEN, {
    method: "POST",
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: "refresh_token", refresh_token: c.refresh_token }),
  });
  const t = await json<TokenResponse>(res, "refresh token");
  return { conn: { ...c, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at }, refreshed: true };
}

const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

export async function getActivity(f: Fetch, token: string, id: number): Promise<StravaActivity> {
  return json(await f(`${STRAVA_API}/activities/${id}`, auth(token)), `aktivitas ${id}`);
}

export async function listActivities(f: Fetch, token: string, afterEpoch: number): Promise<StravaActivity[]> {
  return json(await f(`${STRAVA_API}/athlete/activities?after=${afterEpoch}&per_page=50`, auth(token)), "daftar aktivitas");
}

export async function getStreams(f: Fetch, token: string, id: number): Promise<StravaStreams> {
  const keys = "time,distance,heartrate,cadence,velocity_smooth";
  const res = await f(`${STRAVA_API}/activities/${id}/streams?keys=${keys}&key_by_type=true`, auth(token));
  if (res.status === 404) return {}; // aktivitas manual: tanpa streams
  return normalizeStreams(await json<unknown>(res, `streams ${id}`));
}

/** Cabut akses (endpoint /oauth/revoke, Basic auth client; mencabut refresh token ikut mencabut access token). */
export async function revoke(f: Fetch, creds: { clientId: string; clientSecret: string }, refreshToken: string): Promise<boolean> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = await f(STRAVA_REVOKE, {
    method: "POST",
    headers: { authorization: `Basic ${basic}` },
    body: new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token" }),
  }).catch(() => null);
  return !!res?.ok;
}

/** Aktivitas + streams Strava → ParsedActivity (format yang sama dengan import file). */
export function toParsedActivity(a: StravaActivity, s: StravaStreams): ParsedActivity {
  const warnings: string[] = [];
  const time = s.time?.data ?? [];
  let samples: Sample[] = time.map((t, i) => ({
    t,
    d: s.distance?.data[i] ?? null,
    hr: s.heartrate?.data[i] ?? null,
    cad: s.cadence?.data[i] ?? null,
  }));
  if (!samples.length) {
    warnings.push("Strava tidak memberi data per detik (aktivitas manual?) — hanya total yang dipakai.");
    samples = [
      { t: 0, d: 0, hr: null, cad: null },
      { t: a.moving_time, d: a.distance, hr: null, cad: null },
    ];
  } else {
    const norm = normalizeCadence(samples);
    samples = norm.samples;
    if (norm.doubled) warnings.push("Cadence Strava per-kaki → dikali 2 (langkah/menit).");
    if (!samples.some((x) => x.hr != null)) warnings.push("Aktivitas tanpa data HR.");
  }
  return {
    format: "strava",
    external_id: `strava:${a.id}`,
    start: new Date(a.start_date).toISOString(),
    device: a.device_name ?? null,
    samples,
    laps: [],
    distance_m: a.distance,
    duration_s: a.moving_time,
    warnings,
  };
}
