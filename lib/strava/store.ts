import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSupabaseServer, currentUserId, supabaseConfigured } from "@/lib/supabase/server";
import type { ImportDraft } from "@/lib/log/draft";
import type { StravaConnection } from "./api";

/** Aktivitas Strava yang sudah ditarik tapi belum jadi log (menunggu RPE/rasa dari atlet). */
export interface InboxItem {
  activity_id: number;
  name: string;
  start_date: string;
  draft: ImportDraft;
  status: "pending" | "dismissed";
  created_at: string;
}

export interface StravaStore {
  getConnection(): Promise<StravaConnection | null>;
  saveConnection(c: StravaConnection): Promise<void>;
  deleteConnection(): Promise<void>;
  listInbox(): Promise<InboxItem[]>;
  getInbox(activityId: number): Promise<InboxItem | null>;
  putInbox(item: InboxItem): Promise<void>;
  setInboxStatus(activityId: number, status: InboxItem["status"]): Promise<void>;
  deleteInbox(activityId: number): Promise<void>;
}

interface FileDb { connection: StravaConnection | null; inbox: InboxItem[] }

function fileStravaStore(dir = process.env.LOCAL_DATA_DIR ?? path.join(process.cwd(), ".local-data")): StravaStore {
  const file = path.join(dir, "strava.json");
  const load = async (): Promise<FileDb> => {
    try { return JSON.parse(await readFile(file, "utf-8")); } catch { return { connection: null, inbox: [] }; }
  };
  const save = async (db: FileDb) => {
    await mkdir(dir, { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(db), "utf-8");
    await rename(`${file}.tmp`, file);
  };
  const edit = async (fn: (db: FileDb) => void) => { const db = await load(); fn(db); await save(db); };
  return {
    getConnection: async () => (await load()).connection,
    saveConnection: (c) => edit((db) => { db.connection = c; }),
    deleteConnection: () => edit((db) => { db.connection = null; }),
    listInbox: async () => (await load()).inbox.slice().sort((a, b) => b.start_date.localeCompare(a.start_date)),
    getInbox: async (id) => (await load()).inbox.find((i) => i.activity_id === id) ?? null,
    putInbox: (item) => edit((db) => { db.inbox = [...db.inbox.filter((i) => i.activity_id !== item.activity_id), item]; }),
    setInboxStatus: (id, status) => edit((db) => { db.inbox = db.inbox.map((i) => (i.activity_id === id ? { ...i, status } : i)); }),
    deleteInbox: (id) => edit((db) => { db.inbox = db.inbox.filter((i) => i.activity_id !== id); }),
  };
}

function supabaseStravaStore(): StravaStore {
  const db = () => createSupabaseServer();
  const check = <T,>(r: { data: T; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toItem = (r: any): InboxItem => ({
    activity_id: Number(r.activity_id), name: r.name, start_date: r.start_date, draft: r.draft, status: r.status, created_at: r.created_at,
  });
  return {
    async getConnection() {
      const r = check(await (await db()).from("strava_connections").select("*").maybeSingle());
      if (!r) return null;
      return {
        athlete_id: Number(r.athlete_id), athlete_name: r.athlete_name, access_token: r.access_token, refresh_token: r.refresh_token,
        expires_at: Number(r.expires_at), scope: r.scope, last_sync_at: r.last_sync_at,
      };
    },
    async saveConnection(c) {
      check(await (await db()).from("strava_connections").upsert({ user_id: await currentUserId(), ...c }, { onConflict: "user_id" }));
    },
    async deleteConnection() {
      check(await (await db()).from("strava_connections").delete().eq("user_id", await currentUserId()));
    },
    async listInbox() {
      return (check(await (await db()).from("strava_inbox").select("*").order("start_date", { ascending: false })) ?? []).map(toItem);
    },
    async getInbox(id) {
      const r = check(await (await db()).from("strava_inbox").select("*").eq("activity_id", id).maybeSingle());
      return r ? toItem(r) : null;
    },
    async putInbox(item) {
      check(await (await db()).from("strava_inbox").upsert({ user_id: await currentUserId(), ...item }, { onConflict: "user_id,activity_id" }));
    },
    async setInboxStatus(id, status) {
      check(await (await db()).from("strava_inbox").update({ status }).eq("activity_id", id));
    },
    async deleteInbox(id) {
      check(await (await db()).from("strava_inbox").delete().eq("activity_id", id));
    },
  };
}

export function getStravaStore(): StravaStore {
  if (supabaseConfigured()) return supabaseStravaStore();
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_STORE !== "1") throw new Error("Supabase belum dikonfigurasi.");
  return fileStravaStore();
}
