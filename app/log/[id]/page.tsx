import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlan } from "@/lib/data/plan";
import { getStore } from "@/lib/data/store";
import { formatDateId } from "@/lib/dates";
import { formatPace } from "@/lib/engine/pace";
import { formatDuration } from "@/lib/log/units";
import { RED_FLAGS, STOP_REASON_LABEL } from "@/lib/log/schema";
import { STOP_MESSAGE } from "@/lib/log/safety";
import { SessionCard } from "@/components/session-card";
import { DeleteLogButton } from "@/components/delete-log-button";
import { CoachFeedback } from "@/components/coach-feedback";

export const dynamic = "force-dynamic";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right tabular-nums">{v}</dd>
    </div>
  );
}

export default async function LogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [plan, log] = await Promise.all([getPlan(), getStore().getLog(id)]);
  if (!log) notFound();
  const session = log.session_key ? plan.sessions.find((s) => s.id === log.session_key) : undefined;
  const tiz = log.time_in_zone;
  const tizTotal = tiz ? Object.values(tiz).reduce((a, b) => a + b, 0) : 0;

  return (
    <main className="flex flex-col gap-4">
      <nav className="text-sm"><Link href="/log" className="text-muted-foreground hover:underline">← Log</Link></nav>
      <h1 className="text-xl font-semibold">{formatDateId(log.date)}</h1>

      {log.safety.level === "stop" && (
        <div role="alert" className="rounded-xl border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-semibold">STOP — periksa ke dokter</p>
          <p>{STOP_MESSAGE}</p>
        </div>
      )}

      <dl className="divide-y rounded-xl border bg-card px-4 text-sm">
        <Row k="Jarak" v={`${(log.distance_m / 1000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} km${session ? ` / ${session.planned_km} km rencana` : ""}`} />
        <Row k="Durasi" v={formatDuration(log.duration_s)} />
        <Row k="Pace rata-rata" v={log.avg_pace_s ? `${formatPace(log.avg_pace_s)}/km` : "–"} />
        <Row k="HR avg / max" v={`${log.avg_hr ?? "–"} / ${log.max_hr ?? "–"} bpm (${log.hr_source === "chest" ? "chest strap" : "jam"})`} />
        <Row k="Cadence" v={log.avg_cadence ? `${log.avg_cadence} spm` : "–"} />
        <Row k="RPE" v={log.rpe} />
        {log.hr_drop_1min != null && <Row k="HR turun 1 menit" v={`${log.hr_drop_1min} bpm`} />}
        {log.discomfort_at_hr.flag && <Row k="HR 170 terasa berat" v={log.discomfort_at_hr.bpm ? `mulai ${log.discomfort_at_hr.bpm} bpm` : "ya"} />}
        {(log.temp_c != null || log.humidity != null) && <Row k="Cuaca" v={`${log.temp_c ?? "–"}°C · ${log.humidity ?? "–"}%`} />}
        {log.pain.score > 0 && <Row k="Nyeri" v={`${log.pain.score}/10${log.pain.location ? ` · ${log.pain.location}` : ""}${log.pain.sharp ? " · tajam" : ""}`} />}
        {log.red_flags.length > 0 && <Row k="Red flag" v={log.red_flags.map((f) => RED_FLAGS.find((x) => x.id === f)?.label).join(", ")} />}
        {log.notes && <Row k="Catatan" v={<span className="whitespace-pre-wrap">{log.notes}</span>} />}
      </dl>

      {tiz && tizTotal > 0 && (
        <section className="rounded-xl border bg-card p-4 text-sm">
          <p className="mb-2 font-medium">Waktu di zona (LTHR {plan.hrProfile.lthr})</p>
          <ul className="flex flex-col gap-1">
            {(Object.keys(tiz) as Array<keyof typeof tiz>).map((z) => (
              <li key={z} className="grid grid-cols-[2rem_1fr_3.5rem] items-center gap-2 tabular-nums">
                <span>{z}</span>
                <span className="h-2 rounded bg-muted"><span className="block h-2 rounded bg-primary" style={{ width: `${(tiz[z] / tizTotal) * 100}%` }} /></span>
                <span className="text-right">{formatDuration(tiz[z])}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {log.reps.length > 0 && (
        <section className="rounded-xl border bg-card p-4 text-sm">
          <p className="mb-2 font-medium">Rep</p>
          <table className="w-full tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr><th className="text-left">#</th><th className="text-right">Jarak</th><th className="text-right">Pace</th><th className="text-right">HR</th><th className="text-right">Turun 60″</th><th className="text-right">Status</th></tr>
            </thead>
            <tbody>
              {log.reps.map((r) => (
                <tr key={r.index} className="border-t">
                  <td className="py-1">{r.index}</td>
                  <td className="text-right">{r.distance_m ? `${r.distance_m} m` : "–"}</td>
                  <td className="text-right">{r.pace_s ? formatPace(r.pace_s) : "–"}</td>
                  <td className="text-right">{r.avg_hr ?? "–"}</td>
                  <td className="text-right">{r.hr_drop_60s ?? "–"}</td>
                  <td className="text-right">{r.completed ? "✓" : `✗ ${r.stop_reason ? STOP_REASON_LABEL[r.stop_reason] : ""}${r.stop_at_s ? ` @${formatDuration(r.stop_at_s)}` : ""}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {log.safety.level !== "stop" && (
        <CoachFeedback logId={log.id} initial={log.coach_feedback ?? null} aiReady={!!process.env.ANTHROPIC_API_KEY} />
      )}

      {session && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Rencana sesi {session.id}</summary>
          <div className="mt-2"><SessionCard session={session} pace={plan.paceProfile} hr={plan.hrProfile} /></div>
        </details>
      )}

      <DeleteLogButton id={log.id} />
    </main>
  );
}
