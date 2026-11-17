// Menarik aktivitas Strava → draft di inbox. Tidak pernah menyimpan log otomatis: RPE, nyeri, dan
// red flag hanya atlet yang tahu, jadi log baru dibuat saat atlet melengkapinya (tanpa mengarang data).
import type { PaceProfile, Session } from "@/lib/engine/types";
import type { WorkoutLog } from "@/lib/log/schema";
import { buildDraft } from "@/lib/log/draft";
import { todayIso } from "@/lib/dates";
import {
  ensureFresh, getActivity, getStreams, isRun, listActivities, toParsedActivity,
  type Fetch, type StravaActivity, type StravaConnection,
} from "./api";
import type { InboxItem, StravaStore } from "./store";

export interface IngestDeps {
  fetch: Fetch;
  creds: { clientId: string; clientSecret: string };
  store: StravaStore;
  listLogs(): Promise<WorkoutLog[]>;
  plan(): Promise<{ lthr: number; profile: PaceProfile; sessions: Session[] }>;
  notify?(item: InboxItem): Promise<void>;
  now?: () => Date;
}

export type IngestResult =
  | { status: "added"; item: InboxItem }
  | { status: "skipped"; reason: string };

/** Sudah tercatat? (id Strava sama, atau log lain di tanggal sama dengan jarak & durasi ±3%) */
export function alreadyLogged(a: StravaActivity, logs: WorkoutLog[]): WorkoutLog | null {
  const date = todayIso(new Date(a.start_date));
  return logs.find((l) => l.external_id === `strava:${a.id}`)
    ?? logs.find((l) => l.date === date
      && Math.abs(l.distance_m - a.distance) <= a.distance * 0.03
      && Math.abs(l.duration_s - a.moving_time) <= a.moving_time * 0.03)
    ?? null;
}

async function token(d: IngestDeps): Promise<StravaConnection> {
  const c = await d.store.getConnection();
  if (!c) throw new Error("Strava belum dihubungkan");
  const { conn, refreshed } = await ensureFresh(d.fetch, d.creds, c, Math.floor((d.now?.() ?? new Date()).getTime() / 1000));
  if (refreshed) await d.store.saveConnection(conn);
  return conn;
}

export async function ingestActivity(d: IngestDeps, id: number, known?: StravaActivity): Promise<IngestResult> {
  const existing = await d.store.getInbox(id);
  if (existing) return { status: "skipped", reason: existing.status === "dismissed" ? "diabaikan" : "sudah di inbox" };
  const conn = await token(d);
  const a = known ?? await getActivity(d.fetch, conn.access_token, id);
  if (!isRun(a)) return { status: "skipped", reason: `bukan lari (${a.sport_type ?? a.type})` };
  const dup = alreadyLogged(a, await d.listLogs());
  if (dup) return { status: "skipped", reason: `sudah tercatat (log ${dup.date})` };
  const streams = await getStreams(d.fetch, conn.access_token, id);
  const p = await d.plan();
  const draft = buildDraft(toParsedActivity(a, streams), {
    lthr: p.lthr, profile: p.profile, sessions: p.sessions, fileName: `strava-${id}`, hrSource: "wrist",
  });
  const item: InboxItem = {
    activity_id: id, name: a.name, start_date: a.start_date, draft, status: "pending",
    created_at: (d.now?.() ?? new Date()).toISOString(),
  };
  await d.store.putInbox(item);
  await d.notify?.(item).catch(() => {});
  return { status: "added", item };
}

/** Tarik aktivitas N hari terakhir (sinkron manual & cadangan cron bila webhook terlewat). */
export async function syncRecent(d: IngestDeps, days: number): Promise<{ added: number; skipped: number; errors: string[] }> {
  const conn = await token(d);
  const now = d.now?.() ?? new Date();
  const after = Math.floor(now.getTime() / 1000) - days * 86400;
  const list = await listActivities(d.fetch, conn.access_token, after);
  let added = 0, skipped = 0;
  const errors: string[] = [];
  for (const a of list.filter(isRun)) {
    try {
      const r = await ingestActivity(d, a.id, a);
      if (r.status === "added") added++; else skipped++;
    } catch (e) {
      errors.push(`${a.id}: ${(e as Error).message}`);
    }
  }
  await d.store.saveConnection({ ...(await d.store.getConnection())!, last_sync_at: now.toISOString() });
  return { added, skipped, errors };
}

// ------------------------------------------------------------------ webhook
export interface WebhookEvent {
  object_type: "activity" | "athlete";
  object_id: number;
  aspect_type: "create" | "update" | "delete";
  owner_id: number;
  subscription_id: number;
  event_time: number;
  updates?: Record<string, string>;
}

/** Event webhook → aksi. Event dari atlet lain / subscription lain diabaikan. */
export async function handleWebhookEvent(
  d: IngestDeps, e: WebhookEvent, expectedSubscription: number | null,
): Promise<string> {
  if (expectedSubscription != null && e.subscription_id !== expectedSubscription) return "subscription lain — diabaikan";
  const conn = await d.store.getConnection();
  if (!conn || conn.athlete_id !== e.owner_id) return "atlet tidak dikenal — diabaikan";
  if (e.object_type === "athlete" && e.updates?.authorized === "false") {
    await d.store.deleteConnection();
    return "akses dicabut dari Strava — koneksi dihapus";
  }
  if (e.object_type !== "activity") return "bukan aktivitas";
  if (e.aspect_type === "delete") {
    const item = await d.store.getInbox(e.object_id);
    if (item?.status === "pending") await d.store.deleteInbox(e.object_id);
    return "aktivitas dihapus di Strava (log yang sudah dibuat tidak dihapus)";
  }
  // create, dan update (mis. privasi diubah / sport_type diperbaiki) → coba tarik
  const r = await ingestActivity(d, e.object_id);
  return r.status === "added" ? "masuk inbox" : r.reason;
}
