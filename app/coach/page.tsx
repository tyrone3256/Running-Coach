import Link from "next/link";
import { loadState } from "@/lib/data/engine-service";
import { feedbackForLog } from "@/lib/coach/feedback";
import { HR170_DANGER, HR170_NORMAL, MISSED_RULES, PURPOSE } from "@/lib/coach/content";
import { CoachFeedback } from "@/components/coach-feedback";
import { ReportSymptoms } from "@/components/report-symptoms";
import { SessionCard } from "@/components/session-card";
import { CUES_HR170, QUALITY_TYPES, assessQuality, sessionOf } from "@/lib/engine/analysis";
import { acwr, weekKm } from "@/lib/engine/guardrails";
import { plannedZ4Minutes } from "@/lib/engine/pace";
import { computeHold } from "@/lib/engine/rules";
import { isActive } from "@/lib/engine/snapshot";
import { addDays, formatDateId } from "@/lib/dates";
import { SESSION_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

function Q({ title, children, open = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-xl border bg-card">
      <summary className="cursor-pointer list-none px-4 py-3 font-medium marker:hidden">
        <span className="mr-2 inline-block transition group-open:rotate-90">›</span>{title}
      </summary>
      <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm">{children}</div>
    </details>
  );
}

export default async function CoachPage() {
  const st = await loadState();
  const snap = st.snapshot;
  const hold = computeHold(st);
  const hr = { version: 1, lthr: snap.lthr, source: snap.lthrSource };
  const upcoming = snap.sessions.find((s) => isActive(s) && s.date >= st.today);
  const lastLog = st.logs.slice().sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))[0];

  const week = snap.weeks.slice().reverse().find((w) => w.start <= st.today) ?? snap.weeks[0];
  const weekEnd = addDays(week.start, 6);
  const weekLogs = st.logs.filter((l) => l.date >= week.start && l.date <= weekEnd);
  const weekHard = snap.sessions.filter((s) => s.week === week.week && s.is_hard && isActive(s));
  const ac = acwr(st.logs, st.today);

  const quality = st.logs
    .map((l) => ({ l, s: sessionOf(snap, l) }))
    .filter((x) => x.s && QUALITY_TYPES.includes(x.s.type))
    .sort((a, b) => b.l.date.localeCompare(a.l.date))
    .slice(0, 6);

  return (
    <main className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">Coach</h1>
      <p className="text-sm text-muted-foreground">Berbasis aturan program & datamu — tanpa AI. Bukan nasihat medis.</p>

      {hold.active && (
        <p role="alert" className="rounded-xl border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          Program ditahan karena red flag ({hold.reasons.join(", ")}). Tidak ada saran latihan sampai kamu sudah diperiksa dokter — tandai di layar <Link href="/" className="underline">Hari ini</Link>.
        </p>
      )}

      {!hold.active && (
        <Q title={upcoming?.date === st.today ? "Sesi hari ini & fokusnya" : "Sesi berikutnya & fokusnya"} open>
          {upcoming ? (
            <>
              <SessionCard session={upcoming} pace={snap.paceProfile} hr={hr} />
              <p><b>Tujuan:</b> {PURPOSE[upcoming.type]}</p>
              {QUALITY_TYPES.includes(upcoming.type) && (
                <div>
                  <p className="font-medium">Cue HR 170</p>
                  <ul className="list-disc pl-4 text-xs leading-relaxed">{CUES_HR170.slice(0, 4).map((c) => <li key={c}>{c}</li>)}</ul>
                </div>
              )}
            </>
          ) : <p>Tidak ada sesi tersisa.</p>}
        </Q>
      )}

      <Q title="Feedback lari terakhir" open={!!lastLog}>
        {lastLog ? (
          <>
            <CoachFeedback fb={feedbackForLog(lastLog, st)} title={formatDateId(lastLog.date)} />
            <Link href={`/log/${lastLog.id}`} className="text-xs underline">Buka log</Link>
          </>
        ) : <p>Belum ada log. Setelah lari, isi di menu <Link href="/log/new" className="underline">Log</Link>.</p>}
      </Q>

      <Q title="Toleransi Z4 (sesi kualitas terakhir)">
        {quality.length ? (
          <table className="w-full text-xs tabular-nums">
            <thead className="text-muted-foreground">
              <tr><th className="text-left">Tanggal</th><th className="text-left">Sesi</th><th>Z4</th><th>Rep</th><th>Status</th></tr>
            </thead>
            <tbody>
              {quality.map(({ l, s }) => {
                const q = assessQuality(l, s!, snap.paceProfile, snap.lthr);
                const plan = s!.z4_target_min ?? Math.round(plannedZ4Minutes(s!, snap.paceProfile));
                return (
                  <tr key={l.id} className="border-t">
                    <td className="py-1">{l.date.slice(5)}</td>
                    <td>{SESSION_LABEL[s!.type]}</td>
                    <td className="text-center">{l.time_in_zone ? `${Math.round(l.time_in_zone.Z4 / 60)}` : "–"}/{plan}′</td>
                    <td className="text-center">{l.reps.length ? `${l.reps.filter((r) => r.completed).length}/${l.reps.length}` : "–"}</td>
                    <td className="text-center">{q.failed ? "⚠" : "✓"}{l.discomfort_at_hr.flag ? " HR berat" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p>Belum ada sesi kualitas tercatat.</p>}
        <p className="text-xs text-muted-foreground">Menit Z4 terisi bila kamu mengisi “Waktu di zona HR” di log (zona disamakan dulu di Pengaturan).</p>
      </Q>

      <Q title={`Ringkasan minggu ini (W${String(week.week).padStart(2, "0")})`}>
        <ul className="flex flex-col gap-1">
          <li>Km: <b>{(weekLogs.reduce((a, l) => a + l.distance_m, 0) / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}</b> dari {weekKm(snap, week.week).toLocaleString("id-ID")} rencana</li>
          <li>Sesi tercatat: {weekLogs.length}</li>
          <li>Sesi keras minggu ini: {weekHard.map((s) => `${SESSION_LABEL[s.type]} (${formatDateId(s.date)})`).join(", ") || "tidak ada"}</li>
          <li>ACWR: {ac.ratio == null ? "belum cukup data (butuh ±4 minggu log)" : `${ac.ratio.toFixed(2).replace(".", ",")} (aman 0,8–1,3)`}</li>
        </ul>
      </Q>

      <Q title="HR 170 terasa berat — normal atau bahaya?">
        <div>
          <p className="font-medium">Normal di threshold (lanjutkan, pakai cue):</p>
          <ul className="list-disc pl-4">{HR170_NORMAL.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <ul className="list-disc pl-4 text-xs">{CUES_HR170.map((c) => <li key={c}>{c}</li>)}</ul>
        <div className="rounded-lg border border-destructive/40 p-3">
          <p className="font-medium text-destructive">BAHAYA — berhenti, jangan lanjut, periksa ke dokter (EKG / treadmill test). Berat atau masih berlangsung: 119 / IGD.</p>
          <ul className="list-disc pl-4">{HR170_DANGER.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </Q>

      <Q title="Terlewat sesi / harus geser jadwal?">
        <ul className="list-disc pl-4">{MISSED_RULES.map((x) => <li key={x}>{x}</li>)}</ul>
      </Q>

      <Q title="Lapor gejala bahaya">
        <p className="text-muted-foreground">Kapan pun mengalami ini (tidak harus saat lari), laporkan. Program langsung ditahan sampai kamu menyatakan sudah diperiksa dokter.</p>
        <ReportSymptoms />
      </Q>
    </main>
  );
}
