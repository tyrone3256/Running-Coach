import "server-only";
import { getStore } from "@/lib/data/store";
import { getPlan } from "@/lib/data/plan";
import { pushConfigured, sendToAll } from "@/lib/push/send";
import { getStravaStore } from "./store";
import type { IngestDeps } from "./ingest";

export function stravaConfigured(): boolean {
  return !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
}

export function stravaCreds() {
  if (!stravaConfigured()) throw new Error("STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET belum diisi");
  return { clientId: process.env.STRAVA_CLIENT_ID!, clientSecret: process.env.STRAVA_CLIENT_SECRET! };
}

export function ingestDeps(): IngestDeps {
  return {
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
    creds: stravaCreds(),
    store: getStravaStore(),
    listLogs: () => getStore().listLogs(),
    async plan() {
      const p = await getPlan();
      return { lthr: p.hrProfile.lthr, profile: p.paceProfile, sessions: p.sessions };
    },
    async notify(item) {
      if (!pushConfigured()) return;
      const km = (item.draft.log.distance_m / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 });
      await sendToAll({
        title: "Lari baru dari Strava",
        body: `${item.name} · ${km} km. Lengkapi RPE & rasa supaya program menyesuaikan.`,
        url: `/log/strava/${item.activity_id}`, tag: `strava-${item.activity_id}`,
      });
    },
  };
}
