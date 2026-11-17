import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CheckinInput, WorkoutLog, WorkoutLogInput } from "@/lib/log/schema";
import { assessLogSafety } from "@/lib/log/safety";
import { paceOf } from "@/lib/log/units";
import { createSupabaseServer, supabaseConfigured } from "@/lib/supabase/server";

export type Checkin = CheckinInput & { created_at: string };

export interface Store {
  kind: "file" | "supabase";
  listLogs(opts?: { from?: string; to?: string; limit?: number }): Promise<WorkoutLog[]>;
  getLog(id: string): Promise<WorkoutLog | null>;
  saveLog(input: WorkoutLogInput): Promise<{ log: WorkoutLog; duplicate: boolean }>;
  deleteLog(id: string): Promise<void>;
  annotateLog(id: string, a: { sensor_suspect: boolean; sensor_suspect_reason: string | null }): Promise<void>;
  getCheckin(date: string): Promise<Checkin | null>;
  listCheckins(from: string, to: string): Promise<Checkin[]>;
  saveCheckin(input: CheckinInput): Promise<Checkin>;
}

export function enrich(input: WorkoutLogInput, id: string = randomUUID(), created_at = new Date().toISOString()): WorkoutLog {
  return {
    ...input,
    id,
    created_at,
    avg_pace_s: paceOf(input.distance_m, input.duration_s),
    safety: assessLogSafety(input),
  };
}

// ------------------------------------------------------------------ file (dev lokal)
interface FileDb { logs: WorkoutLog[]; checkins: Checkin[] }

export function fileStore(dir = process.env.LOCAL_DATA_DIR ?? path.join(process.cwd(), ".local-data")): Store {
  const file = path.join(dir, "db.json");
  const load = async (): Promise<FileDb> => {
    try {
      return JSON.parse(await readFile(file, "utf-8")) as FileDb;
    } catch {
      return { logs: [], checkins: [] };
    }
  };
  const save = async (db: FileDb) => {
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(db, null, 1), "utf-8");
    await rename(tmp, file);
  };
  const inRange = (d: string, from?: string, to?: string) => (!from || d >= from) && (!to || d <= to);
  return {
    kind: "file",
    async listLogs({ from, to, limit } = {}) {
      const db = await load();
      const rows = db.logs.filter((l) => inRange(l.date, from, to))
        .sort((a, b) => (b.date + b.created_at).localeCompare(a.date + a.created_at));
      return limit ? rows.slice(0, limit) : rows;
    },
    async getLog(id) {
      return (await load()).logs.find((l) => l.id === id) ?? null;
    },
    async saveLog(input) {
      const db = await load();
      if (input.external_id) {
        const dup = db.logs.find((l) => l.source === input.source && l.external_id === input.external_id);
        if (dup) return { log: dup, duplicate: true };
      }
      const log = enrich(input);
      db.logs.push(log);
      await save(db);
      return { log, duplicate: false };
    },
    async deleteLog(id) {
      const db = await load();
      db.logs = db.logs.filter((l) => l.id !== id);
      await save(db);
    },
    async annotateLog(id, a) {
      const db = await load();
      db.logs = db.logs.map((l) => (l.id === id ? { ...l, ...a } : l));
      await save(db);
    },
    async getCheckin(date) {
      return (await load()).checkins.find((c) => c.date === date) ?? null;
    },
    async listCheckins(from, to) {
      return (await load()).checkins.filter((c) => inRange(c.date, from, to)).sort((a, b) => a.date.localeCompare(b.date));
    },
    async saveCheckin(input) {
      const db = await load();
      const row = { ...input, created_at: new Date().toISOString() };
      db.checkins = [...db.checkins.filter((c) => c.date !== input.date), row];
      await save(db);
      return row;
    },
  };
}

// ------------------------------------------------------------------ Supabase (RLS)
function supabaseStore(): Store {
  const db = () => createSupabaseServer();
  const uid = async () => {
    const { data, error } = await (await db()).auth.getUser();
    if (error || !data.user) throw new Error("Belum login");
    return data.user.id;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toLog = (r: any): WorkoutLog => ({
    id: r.id, created_at: r.created_at, date: r.date, session_key: r.session_key,
    distance_m: Number(r.distance_m), duration_s: r.duration_s, avg_pace_s: r.avg_pace_s,
    avg_hr: r.avg_hr, max_hr: r.max_hr, hr_source: r.hr_source, avg_cadence: r.avg_cadence, rpe: r.rpe,
    reps: r.reps ?? [], time_in_zone: r.time_in_zone, hr_drop_1min: r.hr_drop_1min,
    discomfort_at_hr: r.discomfort_at_hr ?? { flag: false, bpm: null }, rep_incomplete: r.rep_incomplete,
    temp_c: r.temp_c, humidity: r.humidity, pain: r.pain ?? { score: 0, location: null, sharp: false },
    red_flags: r.red_flags ?? [], notes: r.notes, source: r.source, external_id: r.external_id,
    streams: r.streams, safety: r.safety,
    sensor_suspect: r.sensor_suspect, sensor_suspect_reason: r.sensor_suspect_reason,
  });
  const check = <T,>(res: { data: T; error: unknown }) => {
    if (res.error) throw new Error(JSON.stringify(res.error));
    return res.data;
  };
  return {
    kind: "supabase",
    async listLogs({ from, to, limit } = {}) {
      let q = (await db()).from("workout_logs").select("*").order("date", { ascending: false })
        .order("created_at", { ascending: false });
      if (from) q = q.gte("date", from);
      if (to) q = q.lte("date", to);
      if (limit) q = q.limit(limit);
      return (check(await q) ?? []).map(toLog);
    },
    async getLog(id) {
      const r = check(await (await db()).from("workout_logs").select("*").eq("id", id).maybeSingle());
      return r ? toLog(r) : null;
    },
    async saveLog(input) {
      const client = await db();
      if (input.external_id) {
        const dup = check(await client.from("workout_logs").select("*").eq("source", input.source)
          .eq("external_id", input.external_id).maybeSingle());
        if (dup) return { log: toLog(dup), duplicate: true };
      }
      const log = enrich(input);
      // id & created_at dibuat oleh DB
      const row: Partial<WorkoutLog> = { ...log };
      delete row.id;
      delete row.created_at;
      const r = check(await client.from("workout_logs").insert({ ...row, user_id: await uid() }).select().single());
      return { log: toLog(r), duplicate: false };
    },
    async deleteLog(id) {
      check(await (await db()).from("workout_logs").delete().eq("id", id));
    },
    async annotateLog(id, a) {
      check(await (await db()).from("workout_logs").update(a).eq("id", id));
    },
    async getCheckin(date) {
      return check(await (await db()).from("daily_checkins").select("*").eq("date", date).maybeSingle());
    },
    async listCheckins(from, to) {
      return check(await (await db()).from("daily_checkins").select("*").gte("date", from).lte("date", to).order("date")) ?? [];
    },
    async saveCheckin(input) {
      return check(await (await db()).from("daily_checkins")
        .upsert({ ...input, user_id: await uid() }, { onConflict: "user_id,date" }).select().single()) as Checkin;
    },
  };
}

/** File store hanya untuk dev lokal; di produksi wajib Supabase (RLS). */
export function getStore(): Store {
  if (supabaseConfigured()) return supabaseStore();
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_STORE !== "1") {
    throw new Error("Supabase belum dikonfigurasi. Isi env Supabase untuk produksi.");
  }
  return fileStore();
}
