import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPlan } from "@/lib/data/plan";
import { getStore } from "@/lib/data/store";
import { getStravaStore } from "@/lib/strava/store";
import { stravaConfigured } from "@/lib/strava/server";
import { toSessionOptions } from "@/lib/data/session-options";
import { LogForm } from "@/components/log-form";
import { StravaItemActions } from "@/components/strava-item-actions";

export const dynamic = "force-dynamic";

/** Lengkapi aktivitas Strava: data sensor sudah terisi, atlet menambah RPE, rasa, nyeri, red flag. */
export default async function StravaItemPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!stravaConfigured() || !Number.isSafeInteger(id)) notFound();
  const [item, plan, logs] = await Promise.all([getStravaStore().getInbox(id), getPlan(), getStore().listLogs()]);
  if (!item) notFound();
  const done = logs.find((l) => l.external_id === `strava:${id}`);
  if (done) redirect(`/log/${done.id}`);
  return (
    <main className="flex flex-col gap-4">
      <nav className="text-sm"><Link href="/log" className="text-muted-foreground hover:underline">← Log</Link></nav>
      <h1 className="text-xl font-semibold">{item.name}</h1>
      <p className="text-sm text-muted-foreground">
        Dari Strava{item.draft.device ? ` · ${item.draft.device}` : ""}. Jarak, durasi, HR, dan rep sudah terisi —
        tambahkan RPE dan rasa, lalu simpan. Program baru menyesuaikan setelah log disimpan.
      </p>
      {item.status === "dismissed" && <p className="rounded-lg bg-muted p-3 text-sm">Aktivitas ini sedang diabaikan.</p>}
      <LogForm
        initial={item.draft.log}
        sessions={toSessionOptions(plan.sessions)}
        quick={false}
        lthr={plan.hrProfile.lthr}
        importMeta={{
          warnings: item.draft.warnings, device: item.draft.device,
          reps_detected: item.draft.reps_detected, reps_expected: item.draft.reps_expected,
        }}
      />
      <StravaItemActions activityId={id} dismissed={item.status === "dismissed"} />
    </main>
  );
}
