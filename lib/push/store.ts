import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createSupabaseServer, currentUserId, supabaseConfigured } from "@/lib/supabase/server";

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://"), "endpoint harus https"),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});
export type PushSub = z.infer<typeof pushSubscriptionSchema>;

export interface PushStore {
  list(): Promise<PushSub[]>;
  add(s: PushSub, ua: string | null): Promise<void>;
  remove(endpoint: string): Promise<void>;
}

function filePushStore(dir = process.env.LOCAL_DATA_DIR ?? path.join(process.cwd(), ".local-data")): PushStore {
  const file = path.join(dir, "push.json");
  const load = async (): Promise<PushSub[]> => {
    try { return JSON.parse(await readFile(file, "utf-8")); } catch { return []; }
  };
  const save = async (subs: PushSub[]) => {
    await mkdir(dir, { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(subs), "utf-8");
    await rename(`${file}.tmp`, file);
  };
  return {
    list: load,
    async add(s) { await save([...(await load()).filter((x) => x.endpoint !== s.endpoint), s]); },
    async remove(endpoint) { await save((await load()).filter((x) => x.endpoint !== endpoint)); },
  };
}

function supabasePushStore(): PushStore {
  const db = () => createSupabaseServer();
  return {
    async list() {
      const { data, error } = await (await db()).from("push_subscriptions").select("endpoint, p256dh, auth");
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
    },
    async add(s, ua) {
      const { error } = await (await db()).from("push_subscriptions").upsert(
        { user_id: await currentUserId(), endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, user_agent: ua },
        { onConflict: "endpoint" },
      );
      if (error) throw new Error(error.message);
    },
    async remove(endpoint) {
      const { error } = await (await db()).from("push_subscriptions").delete().eq("endpoint", endpoint);
      if (error) throw new Error(error.message);
    },
  };
}

export function getPushStore(): PushStore {
  if (supabaseConfigured()) return supabasePushStore();
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_STORE !== "1") throw new Error("Supabase belum dikonfigurasi.");
  return filePushStore();
}
