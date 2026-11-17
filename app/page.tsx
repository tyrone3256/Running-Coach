import Link from "next/link";
import { getPlan, sessionByDate, weekOf } from "@/lib/data/plan";
import { addDays, DAY_LABEL, dayKey, daysBetween, formatDateId, isValidIso, todayIso } from "@/lib/dates";
import { SessionCard } from "@/components/session-card";
import { GYM_LABEL, SESSION_LABEL } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function TodayPage({
  searchParams,
}: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  const plan = await getPlan();
  const realToday = todayIso();
  const today = isValidIso(sp.date) ? sp.date : realToday;
  const lastDay = plan.sessions[plan.sessions.length - 1].date;
  const inProgram = today >= plan.programStart && today <= lastDay;
  const week = inProgram ? weekOf(plan, today) : undefined;
  const session = sessionByDate(plan, today);
  const next = plan.sessions.find((s) => s.date > today);
  const gym = GYM_LABEL[dayKey(today)];
  const toRace = daysBetween(today, plan.race.date);

  return (
    <main className="flex flex-col gap-4">
      <header className="flex items-end justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">{formatDateId(today)}</p>
          <h1 className="text-2xl font-semibold">Hari ini</h1>
        </div>
        <div className="text-right text-sm">
          {week && (
            <p>
              W{String(week.week).padStart(2, "0")} · {week.phase}
              {week.is_recovery_week && " · pemulihan"}
            </p>
          )}
          {toRace >= 0 && <p className="text-muted-foreground">Race H-{toRace}</p>}
        </div>
      </header>

      {today !== realToday && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs">
          Pratinjau tanggal {today}. <Link className="underline" href="/">Kembali ke hari ini</Link>
        </p>
      )}

      {!inProgram && today < plan.programStart && (
        <section className="rounded-xl border bg-card p-4">
          <p className="font-medium">Program mulai {formatDateId(plan.programStart)}</p>
          <p className="text-sm text-muted-foreground">
            {daysBetween(today, plan.programStart)} hari lagi. Pakai minggu ini untuk pemulihan pasca-Borobudur.
          </p>
        </section>
      )}

      {session ? (
        <SessionCard session={session} pace={plan.paceProfile} hr={plan.hrProfile} showDate={false} />
      ) : inProgram ? (
        <section className="rounded-xl border bg-card p-4">
          <p className="text-lg font-semibold">REST lari</p>
          <p className="text-sm text-muted-foreground">Pemulihan. Foam roll & mobility.</p>
        </section>
      ) : null}

      {inProgram && gym && (
        <section className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm">
          <span className="text-muted-foreground">Gym</span>
          <span className="font-medium">{gym}</span>
        </section>
      )}

      {next && (
        <Link href={`/program/${next.id}`} className="rounded-xl border bg-card px-4 py-3 text-sm hover:bg-muted">
          <p className="text-xs text-muted-foreground">Sesi berikutnya · {DAY_LABEL[next.day]} {formatDateId(next.date, { weekday: undefined })}</p>
          <p className="flex items-center gap-2 font-medium">
            {SESSION_LABEL[next.type]} · {next.planned_km.toLocaleString("id-ID")} km
            {next.is_hard && <Badge variant="destructive">KERAS</Badge>}
          </p>
        </Link>
      )}

      <p className="text-xs text-muted-foreground">
        LTHR {plan.hrProfile.lthr} ({plan.hrProfile.source === "estimate" ? "sementara" : "hasil tes"}) · pace profile v
        {plan.paceProfile.version} · data: {plan.source === "seed" ? "seed lokal" : "Supabase"}
        {inProgram && (
          <>
            {" · "}
            <Link className="underline" href={`/?date=${addDays(today, 1)}`}>besok →</Link>
          </>
        )}
      </p>
    </main>
  );
}
