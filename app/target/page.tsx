import Link from "next/link";
import { planningView } from "@/lib/data/planning-service";
import { getPlanStore } from "@/lib/data/plan-store";
import { PlanningForm } from "@/components/planning-form";
import { GoalChange, ProposeButton } from "@/components/planning-actions";
import { ChangeActions } from "@/components/change-actions";
import { RACE_LABEL } from "@/lib/engine/types";
import { formatRaceTime } from "@/lib/plan/time";
import { daysBetween, formatDateId, todayIso } from "@/lib/dates";
import type { GoalAnalysis } from "@/lib/plan/fitness";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const RATING: Record<GoalAnalysis["rating"], { label: string; cls: string }> = {
  dalam_jangkauan: { label: "Dalam jangkauan", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  realistis: { label: "Realistis", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  ambisius: { label: "Ambisius", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  sangat_ambisius: { label: "Sangat ambisius", cls: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

const num = (x: number) => x.toLocaleString("id-ID", { maximumFractionDigits: 1 });
const pace = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function Rating({ a }: { a: GoalAnalysis }) {
  const r = RATING[a.rating];
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", r.cls)}>{r.label}</span>
        <span className="text-xs text-muted-foreground">VDOT target {num(a.goalVdot)} · sekarang {num(a.fitnessVdot)} · pace target {pace(a.goalPace_s)}/km</span>
      </p>
      <p>{a.message}</p>
    </div>
  );
}

export default async function TargetPage() {
  const [v, changes] = await Promise.all([planningView(), getPlanStore().listChanges()]);
  const today = todayIso();
  const pending = changes
    .filter((c) => /^(goal|recalibrate|next-program)/.test(c.key) && (c.mode === "pending" || c.mode === "blocked"))
    .slice(0, 4);
  const recalNeeded = v.saved && v.fitness.source !== "program" && Math.abs(v.fitness.vdot - v.programVdot) >= 1;

  return (
    <main className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Target</h1>
        <p className="text-sm text-muted-foreground">Isi race berikutnya & performa sekarang → dianalisis → program dibuat. Semua perubahan program menunggu persetujuanmu.</p>
      </header>

      <section className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
        <p className="text-xs text-muted-foreground">Race aktif</p>
        <p className="text-lg font-semibold">{v.active.name}{v.active.name !== RACE_LABEL[v.active.distance] ? ` · ${RACE_LABEL[v.active.distance]}` : ""}</p>
        <p className="tabular-nums">
          {formatDateId(v.active.date)}{v.active.date >= today ? ` · H-${daysBetween(today, v.active.date)}` : " · selesai"} · target <b>{formatRaceTime(v.active.goal_time_s)}</b>
        </p>
        {v.active.date >= today && (
          <>
            <Rating a={v.activeAnalysis} />
            <GoalChange distance={v.active.distance} current={formatRaceTime(v.active.goal_time_s)} />
            <p className="text-xs text-muted-foreground">Struktur program tetap; hanya sesi pace race yang memakai target baru.</p>
          </>
        )}
      </section>

      {pending.length > 0 && (
        <section className="flex flex-col gap-3">
          {pending.map((c) => (
            <div key={c.id} className={cn("flex flex-col gap-2 rounded-xl border p-4 text-sm", c.mode === "blocked" ? "border-destructive" : "border-amber-500/60")}>
              <p className="font-medium">{c.mode === "blocked" ? "Ditolak guardrail" : "Menunggu persetujuanmu"} · {c.title}</p>
              <p className="text-muted-foreground">{c.reason}</p>
              {c.blocked_by && <ul className="list-disc pl-4 text-destructive">{c.blocked_by.map((b) => <li key={b}>{b}</li>)}</ul>}
              {c.diff.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs underline">Sebelum → sesudah ({c.diff.length})</summary>
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs tabular-nums">
                    {c.diff.slice(0, 40).map((d) => <li key={d.id}><b>{d.label}</b>: {d.before} → {d.after}</li>)}
                  </ul>
                </details>
              )}
              {c.mode === "pending" && <ChangeActions id={c.id} mode="pending" canRevert={false} />}
            </div>
          ))}
        </section>
      )}

      {v.saved && (
        <section className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
          <p className="font-medium">Analisis kebugaran</p>
          <p>VDOT ±<b>{num(v.fitness.vdot)}</b> ({v.fitness.detail}). Kalibrasi program sekarang: VDOT {num(v.programVdot)}.</p>
          <table className="w-full tabular-nums">
            <tbody>
              {v.predictions.map((p) => (
                <tr key={p.distance} className="border-t">
                  <td className="py-1">{RACE_LABEL[p.distance]}</td>
                  <td className="text-right">prediksi {formatRaceTime(p.time_s)}</td>
                  <td className="text-right text-muted-foreground">{v.profile.pbs[p.distance] ? `PB ${formatRaceTime(v.profile.pbs[p.distance]!.time_s)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {v.fitness.warnings.map((w) => <p key={w} className="text-xs text-amber-700 dark:text-amber-400">⚠ {w}</p>)}
          <p className="text-xs text-muted-foreground">Prediksi = model Daniels dari performa terbaikmu, belum memperhitungkan panas. Tes ulang (Program → Input hasil tes) memperbarui angka ini.</p>
          {recalNeeded && (
            <div className="flex flex-col gap-1 rounded-lg bg-muted p-3">
              <p>Pace latihan program dikalibrasi untuk VDOT {num(v.programVdot)}, sedangkan kebugaranmu ±{num(v.fitness.vdot)}. Samakan supaya easy/tempo/interval sesuai kondisi sekarang?</p>
              <ProposeButton kind="recalibrate" label="Usulkan kalibrasi pace latihan" variant="outline" />
            </div>
          )}
        </section>
      )}

      {v.next && v.profile.next_race && (
        <section className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
          <p className="text-xs text-muted-foreground">Race berikutnya</p>
          <p className="text-lg font-semibold">{v.profile.next_race.name}{v.profile.next_race.name !== RACE_LABEL[v.profile.next_race.distance] ? ` · ${RACE_LABEL[v.profile.next_race.distance]}` : ""}</p>
          <p className="tabular-nums">{formatDateId(v.profile.next_race.date)} · target <b>{formatRaceTime(v.profile.next_race.goal_time_s)}</b> · program mulai {formatDateId(v.next.startDate)} ({v.next.analysis.weeks} minggu)</p>
          <Rating a={v.next.analysis} />
          <ProposeButton kind="program" label="Buat program race ini" />
          <p className="text-xs text-muted-foreground">Program disambung setelah race aktif (nomor minggu melanjutkan); bisa dibuat ulang kapan saja sebelum dimulai. Lihat hasilnya di <Link href="/program" className="underline">Program</Link> setelah disetujui.</p>
        </section>
      )}

      <PlanningForm initial={v.profile} logsWeeklyKm={v.logsWeeklyKm} />
    </main>
  );
}
