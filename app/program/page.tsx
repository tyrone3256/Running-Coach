import Link from "next/link";
import { getPlan } from "@/lib/data/plan";
import { DAY_LABEL, addDays, formatDateId, todayIso } from "@/lib/dates";
import { PHASE_COLOR, SESSION_LABEL } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { RACE_LABEL, type Phase } from "@/lib/engine/types";
import { formatRaceTime } from "@/lib/plan/time";

export const dynamic = "force-dynamic";

export default async function ProgramPage({ searchParams }: { searchParams: Promise<{ race?: string }> }) {
  const plan = await getPlan();
  const sp = await searchParams;
  const today = todayIso();
  const race = plan.races.find((r) => r.id === sp.race) ?? plan.race;
  const weeks = plan.weeks.filter((w) => w.week >= race.first_week && w.week <= race.last_week);
  const phases = [...new Set(weeks.map((w) => w.phase))] as Phase[];
  const total = weeks.reduce((a, w) => a + w.planned_km, 0);
  const current = [...plan.weeks].reverse().find((w) => w.start <= today && addDays(w.start, 6) >= today);

  return (
    <main className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Program {RACE_LABEL[race.distance]} · {weeks.length} minggu</h1>
        <p className="text-sm text-muted-foreground tabular-nums">
          {race.name} · target {formatRaceTime(race.goal_time_s)} · {formatDateId(race.date)} · total {Math.round(total).toLocaleString("id-ID")} km · plan v{plan.planVersion}
        </p>
        {plan.races.length > 1 && (
          <p className="mt-1 flex flex-wrap gap-2 text-xs">
            {plan.races.map((r) => (
              <Link key={r.id} href={`/program?race=${r.id}`}
                className={`rounded-full border px-2 py-0.5 ${r.id === race.id ? "border-primary bg-primary text-primary-foreground" : ""}`}>
                {RACE_LABEL[r.distance]} {r.date.slice(0, 7)}
              </Link>
            ))}
          </p>
        )}
        <p className="mt-1 flex gap-4 text-sm">
          <Link href="/program/changes" className="underline">Perubahan program</Link>
          <Link href="/program/test" className="underline">Input hasil tes</Link>
        </p>
      </header>

      <ul className="flex flex-wrap gap-2 text-xs">
        {phases.map((p) => (
          <li key={p} className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm" style={{ background: PHASE_COLOR[p].header }} />
            {p}
          </li>
        ))}
      </ul>

      <ol className="flex flex-col gap-2">
        {weeks.map((w) => {
          const sessions = plan.sessions.filter((s) => s.week === w.week).sort((a, b) => a.date.localeCompare(b.date));
          const isCurrent = current?.week === w.week;
          return (
            <li key={w.week}>
              <details open={isCurrent} className="group overflow-hidden rounded-xl border bg-card"
                style={{ borderLeft: `6px solid ${PHASE_COLOR[w.phase].header}` }}>
                <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5">
                  <span className="w-9 font-semibold tabular-nums">W{String(w.week).padStart(2, "0")}</span>
                  <span className="flex-1 text-sm">
                    <span className="block">
                      {w.phase}
                      {isCurrent && <span className="ml-1 text-xs text-primary">· minggu ini</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDateId(w.start, { weekday: undefined, month: "short" })}
                    </span>
                  </span>
                  <span className="flex flex-wrap justify-end gap-1">
                    {w.is_recovery_week && <Badge variant="secondary">pemulihan</Badge>}
                    {w.guardrail_exception && <Badge variant="outline">⚠ {w.hard_sessions.length} keras</Badge>}
                  </span>
                  <span className="w-14 text-right text-sm font-medium tabular-nums">
                    {w.planned_km.toLocaleString("id-ID")} km
                  </span>
                </summary>
                <ul className="divide-y border-t text-sm">
                  {sessions.map((s) => (
                    <li key={s.id}>
                      <Link href={`/program/${s.id}`} className={`flex items-center gap-3 px-3 py-2 hover:bg-muted ${s.status && s.status !== "planned" ? "opacity-50 line-through" : ""}`}>
                        <span className="w-14 text-xs text-muted-foreground">{DAY_LABEL[s.day]}</span>
                        <span className="flex-1">{SESSION_LABEL[s.type]}{s.moved_from ? " ↪" : ""}{s.status === "rest" ? " (rest)" : ""}</span>
                        {s.is_hard && <Badge variant="destructive">keras</Badge>}
                        <span className="w-12 text-right tabular-nums">{s.planned_km.toLocaleString("id-ID")}</span>
                      </Link>
                    </li>
                  ))}
                  {w.guardrail_exception && (
                    <li className="px-3 py-2 text-xs text-muted-foreground">
                      {w.hard_sessions.length} sesi keras (aturan maks 2) — menunggu keputusan {w.guardrail_exception.decision_ref}.
                    </li>
                  )}
                </ul>
              </details>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
