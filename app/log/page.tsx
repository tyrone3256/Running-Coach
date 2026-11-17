import Link from "next/link";
import { getPlan } from "@/lib/data/plan";
import { getStore } from "@/lib/data/store";
import { formatDateId } from "@/lib/dates";
import { formatPace } from "@/lib/engine/pace";
import { formatDuration } from "@/lib/log/units";
import { Badge } from "@/components/ui/badge";
import { SESSION_LABEL } from "@/lib/labels";
import { StravaInboxList } from "@/components/strava-inbox-list";
import { pendingInbox } from "@/lib/strava/inbox";

export const dynamic = "force-dynamic";

export default async function LogListPage() {
  const [plan, logs, stravaInbox] = await Promise.all([getPlan(), getStore().listLogs({ limit: 100 }), pendingInbox()]);
  const byId = new Map(plan.sessions.map((s) => [s.id, s]));
  return (
    <main className="flex flex-col gap-4">
      <header className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold">Log</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/log/import" className="rounded-lg border px-3 py-2">Import file</Link>
          <Link href="/log/new" className="rounded-lg bg-primary px-3 py-2 text-primary-foreground">+ Log</Link>
        </div>
      </header>
      <StravaInboxList items={stravaInbox} />
      {logs.length === 0 && stravaInbox.length === 0 && (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Belum ada log. Setelah lari, tekan <b>+ Log</b> (manual, ±30 detik) atau <b>Import file</b>.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {logs.map((l) => {
          const s = l.session_key ? byId.get(l.session_key) : undefined;
          return (
            <li key={l.id}>
              <Link href={`/log/${l.id}`} className="flex flex-col gap-1 rounded-xl border bg-card px-4 py-3 text-sm hover:bg-muted">
                <span className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatDateId(l.date)}{s ? ` · ${s.id}` : " · di luar program"}</span>
                  <span>{l.source}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {s ? SESSION_LABEL[s.type] : "Lari"}
                  {l.safety.level === "stop" && <Badge variant="destructive">STOP</Badge>}
                  {l.safety.level === "medical_check" && <Badge variant="outline">nyeri</Badge>}
                  {l.discomfort_at_hr.flag && <Badge variant="secondary">HR berat</Badge>}
                  {l.rep_incomplete && <Badge variant="secondary">rep tak selesai</Badge>}
                </span>
                <span className="tabular-nums">
                  {(l.distance_m / 1000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} km
                  {s && <span className="text-muted-foreground"> / {s.planned_km.toLocaleString("id-ID")}</span>}
                  {" · "}{formatDuration(l.duration_s)}
                  {l.avg_pace_s && ` · ${formatPace(l.avg_pace_s)}/km`}
                  {l.avg_hr && ` · ${l.avg_hr} bpm`}
                  {" · RPE "}{l.rpe}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
