import type { Session } from "@/lib/engine/types";
import type { SessionOption } from "@/components/log-form";
import { SESSION_LABEL } from "@/lib/labels";

export function toSessionOptions(sessions: Session[]): SessionOption[] {
  return sessions.map((s) => {
    const work = s.segments.find((g) => g.kind === "work");
    const d = work?.distance_m;
    const repLabel = work && (work.reps ?? 1) > 1 && d
      ? `${work.reps}×${d >= 1000 ? `${(d / 1000).toLocaleString("id-ID")} km` : `${d} m`}`
      : null;
    return {
      id: s.id,
      date: s.date,
      label: SESSION_LABEL[s.type],
      planned_km: s.planned_km,
      work_reps: work?.reps ?? null,
      rep_label: repLabel,
    };
  });
}
