import "server-only";
import { getStore } from "@/lib/data/store";
import { getStravaStore, type InboxItem } from "./store";
import { stravaConfigured } from "./server";

/** Item inbox yang masih perlu dilengkapi (belum ada log dengan id Strava itu). */
export async function pendingInbox(): Promise<InboxItem[]> {
  if (!stravaConfigured()) return [];
  try {
    const [items, logs] = await Promise.all([getStravaStore().listInbox(), getStore().listLogs()]);
    const logged = new Set(logs.map((l) => l.external_id).filter(Boolean));
    return items.filter((i) => i.status === "pending" && !logged.has(`strava:${i.activity_id}`));
  } catch {
    return [];
  }
}
