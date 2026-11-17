import "server-only";
import { sendNotification, setVapidDetails } from "web-push";
import { getPushStore } from "./store";
import type { PushPayload } from "./messages";

export function pushConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let ready = false;
function init() {
  if (ready) return;
  if (!pushConfigured()) throw new Error("VAPID key belum diisi (NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)");
  setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.invalid",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  ready = true;
}

/** Kirim ke semua perangkat terdaftar; subscription kedaluwarsa (404/410) dihapus. */
export async function sendToAll(payload: PushPayload): Promise<{ sent: number; removed: number; failed: number }> {
  init();
  const store = getPushStore();
  const subs = await store.list();
  let sent = 0, removed = 0, failed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await sendNotification(s, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "normal" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await store.remove(s.endpoint);
        removed++;
      } else {
        failed++;
        console.error("push gagal", code, (e as Error).message);
      }
    }
  }));
  return { sent, removed, failed };
}
