import { describe, expect, it, vi } from "vitest";
import {
  authorizeUrl, ensureFresh, exchangeCode, normalizeStreams, revoke, toParsedActivity,
  type StravaActivity, type StravaConnection,
} from "./api";
import { alreadyLogged, handleWebhookEvent, ingestActivity, syncRecent, type IngestDeps, type WebhookEvent } from "./ingest";
import type { InboxItem, StravaStore } from "./store";
import { baseSnapshot, mkLog } from "@/test/engine-fixtures";
import { workoutLogSchema } from "@/lib/log/schema";

// ------------------------------------------------------------------ fixture
const creds = { clientId: "123", clientSecret: "shh" };
const NOW = new Date("2027-01-07T12:00:00Z");
const conn = (p: Partial<StravaConnection> = {}): StravaConnection => ({
  athlete_id: 777, athlete_name: "Tyrone", access_token: "AT", refresh_token: "RT",
  expires_at: Math.floor(NOW.getTime() / 1000) + 3600, scope: "read,activity:read_all", last_sync_at: null, ...p,
});

/** Tempo W07 Kamis 2027-01-07: WU 15′ easy, 2×10′ cepat dengan jog 2′, CD 10′ (sampel per 5 dtk). */
function tempoStreams() {
  const time: number[] = [], distance: number[] = [], heartrate: number[] = [], cadence: number[] = [];
  let t = 0, d = 0;
  const block = (sec: number, pace: number, hr: number) => {
    for (let i = 0; i < sec; i += 5) { t += 5; d += 5000 / pace / 1; time.push(t); distance.push(Math.round(d)); heartrate.push(hr); cadence.push(84); }
  };
  block(900, 370, 140); block(600, 292, 166); block(120, 450, 150); block(600, 292, 168); block(600, 380, 145);
  return { time: { data: time }, distance: { data: distance }, heartrate: { data: heartrate }, cadence: { data: cadence } };
}

const activity = (p: Partial<StravaActivity> = {}): StravaActivity => ({
  id: 9001, name: "Tempo Kamis", sport_type: "Run", type: "Run", start_date: "2027-01-06T22:30:00Z", // 05:30 WIB 7 Jan
  distance: 9500, moving_time: 2820, elapsed_time: 2900, average_heartrate: 156, max_heartrate: 172,
  has_heartrate: true, average_cadence: 84, device_name: "HUAWEI WATCH GT 4", ...p,
});

function memStore(c: StravaConnection | null = conn()): StravaStore & { inbox: InboxItem[]; conn: StravaConnection | null } {
  const s = {
    conn: c, inbox: [] as InboxItem[],
    getConnection: async () => s.conn,
    saveConnection: async (x: StravaConnection) => { s.conn = x; },
    deleteConnection: async () => { s.conn = null; },
    listInbox: async () => s.inbox,
    getInbox: async (id: number) => s.inbox.find((i) => i.activity_id === id) ?? null,
    putInbox: async (i: InboxItem) => { s.inbox = [...s.inbox.filter((x) => x.activity_id !== i.activity_id), i]; },
    setInboxStatus: async (id: number, st: InboxItem["status"]) => { s.inbox = s.inbox.map((i) => (i.activity_id === id ? { ...i, status: st } : i)); },
    deleteInbox: async (id: number) => { s.inbox = s.inbox.filter((i) => i.activity_id !== id); },
  };
  return s;
}

/** fetch palsu: routing berdasarkan URL; mencatat setiap panggilan. */
function fakeFetch(routes: Record<string, (init?: RequestInit) => unknown>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    const body = routes[key](init);
    return body instanceof Response ? body : Response.json(body);
  }) as unknown as typeof fetch;
  return { f, calls };
}

function deps(store: StravaStore, f: typeof fetch, logs = [] as ReturnType<typeof mkLog>[]): IngestDeps & { notify: ReturnType<typeof vi.fn> } {
  const snap = baseSnapshot();
  return {
    fetch: f, creds, store, now: () => NOW,
    listLogs: async () => logs,
    plan: async () => ({ lthr: 170, profile: snap.paceProfile, sessions: snap.sessions }),
    notify: vi.fn(async () => {}),
  };
}

// ------------------------------------------------------------------ OAuth
describe("strava: OAuth", () => {
  it("authorize URL: scope activity:read_all, state, response_type=code", () => {
    const u = new URL(authorizeUrl("123", "https://app.example/api/strava/callback", "abc"));
    expect(u.origin + u.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(u.searchParams.get("scope")).toContain("activity:read_all");
    expect(u.searchParams.get("state")).toBe("abc");
    expect(u.searchParams.get("response_type")).toBe("code");
  });

  it("tukar kode → koneksi (form-encoded, athlete id disimpan)", async () => {
    const { f, calls } = fakeFetch({ "/oauth/token": () => ({ access_token: "A", refresh_token: "R", expires_at: 99, athlete: { id: 5, firstname: "Ty", lastname: "A" } }) });
    const c = await exchangeCode(f, creds, "CODE", "read,activity:read_all");
    expect(c).toMatchObject({ athlete_id: 5, athlete_name: "Ty A", access_token: "A", refresh_token: "R", expires_at: 99 });
    const body = calls[0].init!.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("CODE");
  });

  it("token masih valid → tidak refresh; hampir kedaluwarsa → refresh & refresh token baru disimpan", async () => {
    const { f, calls } = fakeFetch({ "/oauth/token": () => ({ access_token: "A2", refresh_token: "R2", expires_at: 5000 }) });
    expect((await ensureFresh(f, creds, conn({ expires_at: 2000 }), 1000)).refreshed).toBe(false);
    const r = await ensureFresh(f, creds, conn({ expires_at: 1100 }), 1000);
    expect(r).toMatchObject({ refreshed: true, conn: { access_token: "A2", refresh_token: "R2", expires_at: 5000 } });
    expect((calls[0].init!.body as URLSearchParams).get("refresh_token")).toBe("RT");
  });

  it("revoke memakai Basic auth client + refresh token", async () => {
    const { f, calls } = fakeFetch({ "/oauth/revoke": () => new Response("", { status: 200 }) });
    expect(await revoke(f, creds, "RT")).toBe(true);
    expect((calls[0].init!.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("123:shh").toString("base64")}`);
    expect((calls[0].init!.body as URLSearchParams).get("token")).toBe("RT");
  });
});

// ------------------------------------------------------------------ konversi
describe("strava: konversi aktivitas", () => {
  it("streams bentuk array (dokumentasi) dan objek per type sama-sama diterima", () => {
    const arr = normalizeStreams([{ type: "heartrate", data: [1, 2] }, { type: "time", data: [0, 1] }]);
    expect(arr.heartrate?.data).toEqual([1, 2]);
    expect(normalizeStreams({ time: { data: [0] } }).time?.data).toEqual([0]);
    expect(normalizeStreams(null)).toEqual({});
  });

  it("cadence per-kaki dikali 2, external_id strava:<id>, total dari Strava", () => {
    const p = toParsedActivity(activity(), tempoStreams());
    expect(p.external_id).toBe("strava:9001");
    expect(p.samples[10].cad).toBe(168);
    expect(p.distance_m).toBe(9500);
    expect(p.duration_s).toBe(2820);
    expect(p.warnings.join(" ")).toMatch(/dikali 2/);
  });

  it("aktivitas manual tanpa streams → hanya total + peringatan", () => {
    const p = toParsedActivity(activity({ manual: true }), {});
    expect(p.samples).toHaveLength(2);
    expect(p.warnings.join(" ")).toMatch(/manual/);
  });
});

// ------------------------------------------------------------------ ingest
describe("strava: ingest ke inbox (tidak mengarang data)", () => {
  const routes = () => ({
    "/activities/9001/streams": () => Object.entries(tempoStreams()).map(([type, v]) => ({ type, ...v })),
    "/activities/9001": () => activity(),
  });

  it("lari baru → draft di inbox: sesi W07-thu, rep terdeteksi, RPE KOSONG (diisi atlet), notifikasi", async () => {
    const store = memStore();
    const d = deps(store, fakeFetch(routes()).f);
    const r = await ingestActivity(d, 9001);
    expect(r.status).toBe("added");
    const item = store.inbox[0];
    expect(item.draft.log.session_key).toBe("W07-thu");
    expect(item.draft.log.date).toBe("2027-01-07");
    expect(item.draft.log.source).toBe("strava");
    expect(item.draft.log.external_id).toBe("strava:9001");
    expect(item.draft.log.rpe).toBeNull();
    expect(item.draft.reps_detected).toBe(2);
    expect(item.draft.log.hr_source).toBe("wrist");
    // draft tidak lolos skema log sampai RPE diisi → tidak bisa jadi log diam-diam
    expect(workoutLogSchema.safeParse(item.draft.log).success).toBe(false);
    expect(workoutLogSchema.safeParse({ ...item.draft.log, rpe: 7 }).success).toBe(true);
    expect(d.notify).toHaveBeenCalledOnce();
  });

  it("bukan lari (Ride/Walk) → dilewati", async () => {
    const store = memStore();
    const { f } = fakeFetch({ "/activities/9001": () => activity({ sport_type: "Walk", type: "Walk" }) });
    expect(await ingestActivity(deps(store, f), 9001)).toEqual({ status: "skipped", reason: "bukan lari (Walk)" });
    expect(store.inbox).toHaveLength(0);
  });

  it("sudah dilog lewat import file (tanggal sama, jarak & durasi ±3%) → tidak dobel", async () => {
    const store = memStore();
    const logs = [mkLog({ date: "2027-01-07", distance_m: 9450, duration_s: 2840, source: "fit" })];
    const r = await ingestActivity(deps(store, fakeFetch(routes()).f, logs), 9001);
    expect(r.status).toBe("skipped");
  });

  it("alreadyLogged mengenali external_id strava", () => {
    expect(alreadyLogged(activity(), [mkLog({ date: "2027-01-01", external_id: "strava:9001", source: "strava" })])).toBeTruthy();
    expect(alreadyLogged(activity(), [mkLog({ date: "2027-01-07", distance_m: 5000 })])).toBeNull();
  });

  it("sudah di inbox / diabaikan → tidak ditarik ulang (hemat rate limit)", async () => {
    const store = memStore();
    const { f, calls } = fakeFetch(routes());
    await ingestActivity(deps(store, f), 9001);
    const n = calls.length;
    await store.setInboxStatus(9001, "dismissed");
    expect(await ingestActivity(deps(store, f), 9001)).toEqual({ status: "skipped", reason: "diabaikan" });
    expect(calls.length).toBe(n);
  });

  it("token kedaluwarsa → refresh dulu, token baru disimpan & dipakai", async () => {
    const store = memStore(conn({ expires_at: Math.floor(NOW.getTime() / 1000) - 10 }));
    const { f, calls } = fakeFetch({ ...routes(), "/oauth/token": () => ({ access_token: "NEW", refresh_token: "R2", expires_at: 9e9 }) });
    await ingestActivity(deps(store, f), 9001);
    expect(store.conn!.refresh_token).toBe("R2");
    const apiCall = calls.find((c) => c.url.includes("/activities/9001"))!;
    expect((apiCall.init!.headers as Record<string, string>).authorization).toBe("Bearer NEW");
  });

  it("sinkron: hanya lari, catat last_sync_at", async () => {
    const store = memStore();
    const { f } = fakeFetch({
      ...routes(),
      "/athlete/activities": () => [activity(), activity({ id: 42, sport_type: "Ride", type: "Ride" })],
    });
    const r = await syncRecent(deps(store, f), 2);
    expect(r).toMatchObject({ added: 1, skipped: 0 });
    expect(store.conn!.last_sync_at).toBe(NOW.toISOString());
  });
});

// ------------------------------------------------------------------ webhook
describe("strava: webhook", () => {
  const evt = (p: Partial<WebhookEvent> = {}): WebhookEvent => ({
    object_type: "activity", object_id: 9001, aspect_type: "create", owner_id: 777, subscription_id: 55, event_time: 1, ...p,
  });
  const routes = {
    "/activities/9001/streams": () => tempoStreams(),
    "/activities/9001": () => activity(),
  };

  it("create dari atlet pemilik → masuk inbox", async () => {
    const store = memStore();
    expect(await handleWebhookEvent(deps(store, fakeFetch(routes).f), evt(), 55)).toBe("masuk inbox");
    expect(store.inbox).toHaveLength(1);
  });

  it("subscription lain atau atlet lain → diabaikan tanpa memanggil API", async () => {
    const store = memStore();
    const { f, calls } = fakeFetch(routes);
    expect(await handleWebhookEvent(deps(store, f), evt({ subscription_id: 1 }), 55)).toMatch(/subscription lain/);
    expect(await handleWebhookEvent(deps(store, f), evt({ owner_id: 1 }), 55)).toMatch(/tidak dikenal/);
    expect(calls).toHaveLength(0);
  });

  it("deauthorize dari Strava → koneksi dihapus", async () => {
    const store = memStore();
    await handleWebhookEvent(deps(store, fakeFetch({}).f), evt({ object_type: "athlete", object_id: 777, aspect_type: "update", updates: { authorized: "false" } }), 55);
    expect(store.conn).toBeNull();
  });

  it("delete: draft pending dihapus, log yang sudah dibuat tidak disentuh", async () => {
    const store = memStore();
    await handleWebhookEvent(deps(store, fakeFetch(routes).f), evt(), 55);
    expect(await handleWebhookEvent(deps(store, fakeFetch(routes).f), evt({ aspect_type: "delete" }), 55)).toMatch(/dihapus/);
    expect(store.inbox).toHaveLength(0);
  });
});
