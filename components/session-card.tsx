import type { HrProfile, PaceProfile, Segment, Session } from "@/lib/engine/types";
import {
  estimateDurationMin, formatHr, formatPaceRange, plannedZ4Minutes, resolveHr, resolvePace, segmentKm,
} from "@/lib/engine/pace";
import { INTENSITY_LABEL, KIND_LABEL, PHASE_COLOR, SESSION_LABEL } from "@/lib/labels";
import { DAY_LABEL, formatDateId } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function segDistance(seg: Segment): string {
  if (seg.kind === "hill") return `${seg.reps}×${seg.duration_s} dtk`;
  if (seg.kind === "test" && seg.duration_s) return `${seg.duration_s / 60} menit`;
  const d = seg.distance_m;
  if (!d) return "";
  const one = d >= 1000 ? `${(d / 1000).toLocaleString("id-ID")} km` : `${d} m`;
  const reps = seg.reps ?? 1;
  return reps > 1 ? `${reps}×${one}` : one;
}

export function SegmentRow({ seg, week, pace, hr }: {
  seg: Segment; week: number; pace: PaceProfile; hr: HrProfile;
}) {
  const p = resolvePace(seg, pace, week);
  const bpm = resolveHr(seg.hr_zone, hr.lthr);
  const isWork = seg.kind === "work" || seg.kind === "test";
  return (
    <li className={cn("grid grid-cols-[3.5rem_1fr_auto] items-baseline gap-x-3 py-2", isWork && "font-medium")}>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{KIND_LABEL[seg.kind]}</span>
      <span>
        {segDistance(seg)}
        <span className="text-muted-foreground"> · {INTENSITY_LABEL[seg.intensity]}</span>
        {seg.note && <span className="block text-xs text-muted-foreground">{seg.note}</span>}
        {seg.target_note && <span className="block text-xs text-muted-foreground">{seg.target_note}</span>}
        {seg.distance_is_estimate && <span className="block text-xs text-muted-foreground">jarak = estimasi</span>}
      </span>
      <span className="text-right tabular-nums">
        <span className="block">{seg.kind === "hill" ? "effort ±90%" : seg.kind === "test" ? "effort rata" : formatPaceRange(p)}</span>
        <span className="block text-xs text-muted-foreground">
          {seg.hr_zone ? `${seg.hr_zone.replace("-", "–")} · ${formatHr(bpm)}` : "—"}
        </span>
      </span>
    </li>
  );
}

export function SessionCard({ session, pace, hr, showDate = true }: {
  session: Session; pace: PaceProfile; hr: HrProfile; showDate?: boolean;
}) {
  const color = PHASE_COLOR[session.phase];
  const z4 = plannedZ4Minutes(session, pace);
  const dur = estimateDurationMin(session, pace);
  const km = session.segments.reduce((a, s) => a + segmentKm(s), 0);
  return (
    <section className="overflow-hidden rounded-xl border bg-card" style={{ borderLeft: `6px solid ${color.header}` }}>
      <header className="flex flex-col gap-1 border-b px-4 py-3">
        {showDate && (
          <p className="text-xs text-muted-foreground">
            {formatDateId(session.date)} · W{String(session.week).padStart(2, "0")} · {session.phase}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{SESSION_LABEL[session.type]}</h2>
          {session.is_hard && <Badge variant="destructive">KERAS</Badge>}
        </div>
        <p className="text-sm text-muted-foreground tabular-nums">
          {session.planned_km.toLocaleString("id-ID")} km rencana · ±{dur} menit
          {Math.abs(km - session.planned_km) > 0.05 && ` · segmen ${km.toLocaleString("id-ID", { maximumFractionDigits: 1 })} km`}
        </p>
        {(session.z4_target_min || z4 > 0) && (
          <p className="text-sm">
            <span className="font-medium">Target Z4:</span>{" "}
            {session.z4_target_min ? `±${session.z4_target_min}′ (tangga)` : "blok HM pace"}
            {z4 > 0 && <span className="text-muted-foreground"> · terencana ±{Math.round(z4)}′</span>}
          </p>
        )}
      </header>
      <ul className="divide-y px-4 text-sm">
        {session.segments.map((seg, i) => (
          <SegmentRow key={i} seg={seg} week={session.week} pace={pace} hr={hr} />
        ))}
      </ul>
      {session.notes.length > 0 && (
        <footer className="border-t px-4 py-2 text-xs text-muted-foreground">
          {session.notes.join(" · ")}
        </footer>
      )}
    </section>
  );
}

export function dayName(session: Session) {
  return DAY_LABEL[session.day];
}
