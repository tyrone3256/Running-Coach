import Link from "next/link";
import { getPlan, sessionByDate, weekOf } from "@/lib/data/plan";
import { addDays, DAY_LABEL, dayKey, daysBetween, formatDateId, isValidIso, todayIso } from "@/lib/dates";
import { SessionCard } from "@/components/session-card";
import { GYM_LABEL, SESSION_LABEL } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { CheckinForm } from "@/components/checkin-form";
import { getStore } from "@/lib/data/store";
import { formatPace } from "@/lib/engine/pace";
import { formatDuration } from "@/lib/log/units";
import { getPlanStore } from "@/lib/data/plan-store";
import { loadState, processTrigger } from "@/lib/data/engine-service";
import { run } from "@/lib/engine/engine";
import { heatAdjustment } from "@/lib/engine/analysis";
import { isActive } from "@/lib/engine/snapshot";
import { HoldBanner } from "@/components/hold-banner";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function TodayPage({
  searchParams,
}: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  const realToday = todayIso();
  const today = isValidIso(sp.date) ? sp.date : realToday;
  // Engine harian (R7 sesi terlewat, R8 ACWR) — hanya untuk tanggal sebenarnya; pratinjau = baca saja.
  const hold = today === realToday
    ? (await processTrigger({ kind: "daily" }, today)).hold
    : run(await loadState(today), { kind: "daily" }).hold;
  const plan = await getPlan();
  const lastDay = plan.sessions[plan.sessions.length - 1].date;
  const inProgram = today >= plan.programStart && today <= lastDay;
  const week = inProgram ? weekOf(plan, today) : undefined;
  const session = sessionByDate(plan, today);
  const next = plan.sessions.find((s) => s.date > today && isActive(s));
  const gym = GYM_LABEL[dayKey(today)];
  const toRace = daysBetween(today, plan.race.date);
  const store = getStore();
  const [checkin, todaysLogs] = await Promise.all([
    store.getCheckin(today),
    store.listLogs({ from: today, to: today }),
  ]);
  const logged = session ? todaysLogs.find((l) => l.session_key === session.id) : todaysLogs[0];
  const ps = getPlanStore();
  const [notices, changes] = await Promise.all([ps.listNotices(), ps.listChanges()]);
  const todaysNotices = notices.filter((n) => n.date === today || (n.level === "warn" && n.date < today && daysBetween(n.date, today) <= 2));
  const pending = changes.filter((c) => c.mode === "pending").length;
  const recentAuto = changes.filter((c) => c.mode === "auto" && !c.reverted_by && daysBetween(c.date, today) <= 2 && c.date <= today);
  const heat = heatAdjustment(checkin?.temp_c, checkin?.humidity);

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

      {hold.active && <HoldBanner reasons={hold.reasons} since={hold.since} />}

      {!hold.active && pending > 0 && (
        <Link href="/program/changes" className="rounded-xl border border-amber-500/60 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950/40">
          <b>{pending} perubahan program</b> menunggu persetujuanmu →
        </Link>
      )}
      {!hold.active && recentAuto.map((c) => (
        <Link key={c.id} href="/program/changes" className="rounded-xl border bg-card px-4 py-3 text-sm">
          <span className="text-xs text-muted-foreground">Program disesuaikan otomatis · {c.rule}</span>
          <span className="block">{c.title}</span>
        </Link>
      ))}

      <CheckinForm date={today} initial={checkin} />

      {!hold.active && todaysNotices.map((n) => (
        <p key={n.key} className={cn("rounded-xl px-4 py-3 text-sm", n.level === "stop" ? "bg-destructive/10 text-destructive" : n.level === "warn" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-muted")}>
          <span className="text-xs opacity-70">{n.rule} · </span>{n.message}
        </p>
      ))}

      {hold.active ? null : session ? (
        <SessionCard session={session} pace={plan.paceProfile} hr={plan.hrProfile} showDate={false} heatAdj={heat} />
      ) : inProgram ? (
        <section className="rounded-xl border bg-card p-4">
          <p className="text-lg font-semibold">REST lari</p>
          <p className="text-sm text-muted-foreground">Pemulihan. Foam roll & mobility.</p>
        </section>
      ) : null}

      {hold.active ? null : logged ? (
        <Link href={`/log/${logged.id}`} className="flex items-center justify-between rounded-xl border border-emerald-500/40 bg-emerald-50 px-4 py-3 text-sm dark:bg-emerald-950/40">
          <span className="font-medium">✓ Sudah di-log</span>
          <span className="tabular-nums">
            {(logged.distance_m / 1000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} km · {formatDuration(logged.duration_s)}
            {logged.avg_pace_s ? ` · ${formatPace(logged.avg_pace_s)}` : ""} · RPE {logged.rpe}
          </span>
        </Link>
      ) : session ? (
        <div className="grid grid-cols-2 gap-2">
          <Link href={`/log/new?session=${session.id}&quick=1`} className="flex h-12 items-center justify-center rounded-xl bg-primary font-medium text-primary-foreground">
            Log cepat
          </Link>
          <Link href="/log/import" className="flex h-12 items-center justify-center rounded-xl border font-medium">
            Import file
          </Link>
        </div>
      ) : null}

      {!hold.active && inProgram && gym && (
        <section className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm">
          <span className="text-muted-foreground">Gym</span>
          <span className="font-medium">{gym}</span>
        </section>
      )}

      {!hold.active && next && (
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
        {plan.paceProfile.version} · data: {plan.source === "supabase" ? "Supabase" : plan.source === "local" ? "lokal (.local-data)" : "seed (read-only)"}
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
