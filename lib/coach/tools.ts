// Tool coach AI. Satu-satunya jalan LLM menyentuh data/plan. Setiap input divalidasi zod,
// setiap perubahan plan dibangun deterministik (actions.ts) dan melewati guardrail engine.
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import seed from "@/seed/plan.json";
import type { EngineState, PlanChangeRecord } from "@/lib/engine/model";
import type { PlanSeed, Session } from "@/lib/engine/types";
import type { WorkoutLog, WorkoutLogInput } from "@/lib/log/schema";
import type { TestInput } from "@/lib/engine/rules";
import { computeHold, readiness } from "@/lib/engine/rules";
import { isActive } from "@/lib/engine/snapshot";
import {
  CUES_HR170, LADDER_TYPES, QUALITY_TYPES, assessQuality, heatAdjustment, sensorCheck, sessionOf,
} from "@/lib/engine/analysis";
import { acwr, weekKm } from "@/lib/engine/guardrails";
import {
  estimateDurationMin, formatHr, formatPace, formatPaceRange, plannedZ4Minutes, resolveHr, resolvePace, zoneTable,
} from "@/lib/engine/pace";
import { addDays, daysBetween } from "@/lib/dates";
import { SESSION_LABEL, INTENSITY_LABEL } from "@/lib/labels";
import { buildCoachAction, coachActionSchema } from "./actions";

// ------------------------------------------------------------------ dependensi (diinjeksi; mock di test)
export interface CoachDeps {
  loadState(): Promise<EngineState>;
  saveLog(input: WorkoutLogInput): Promise<{ log: WorkoutLog; duplicate: boolean; outcome: unknown }>;
  propose(input: { title: string; reason: string; changes: PlanChangeRecord["changes"]; size: "small" | "large"; cues?: string[] }): Promise<PlanChangeRecord>;
  apply(id: string): Promise<{ ok: boolean; violations?: string[] }>;
  submitTest(input: TestInput): Promise<PlanChangeRecord>;
}

/** Efek samping yang perlu ditampilkan UI chat (kartu usulan, log baru). */
export interface ToolEffect {
  kind: "proposal" | "applied" | "log" | "test";
  id: string;
  title: string;
  mode?: PlanChangeRecord["mode"];
  size?: "small" | "large";
}

export interface ToolContext {
  deps: CoachDeps;
  effects: ToolEffect[];
  state?: EngineState;
}

const meta = (seed as unknown as PlanSeed).meta;
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "format YYYY-MM-DD");

async function state(ctx: ToolContext) {
  return (ctx.state ??= await ctx.deps.loadState());
}
function fresh(ctx: ToolContext) {
  ctx.state = undefined; // data berubah → muat ulang di panggilan berikutnya
}

function sessionSummary(s: Session, st: EngineState) {
  const snap = st.snapshot;
  return {
    id: s.id, date: s.date, week: s.week, phase: s.phase, type: s.type, label: SESSION_LABEL[s.type],
    keras: s.is_hard, status: s.status ?? "planned", km: s.planned_km,
    menit_est: estimateDurationMin(s, snap.paceProfile),
    z4_target_min: s.z4_target_min, z4_terencana_min: Math.round(plannedZ4Minutes(s, snap.paceProfile)),
    moved_from: s.moved_from ?? undefined,
    segmen: s.segments.map((g) => ({
      jenis: g.kind, intensitas: `${g.intensity} (${INTENSITY_LABEL[g.intensity]})`,
      reps: g.reps ?? undefined, jarak_m: g.distance_m ?? undefined, durasi_s: g.duration_s ?? undefined,
      pace: g.kind === "hill" || g.kind === "test" ? undefined : formatPaceRange(resolvePace(g, snap.paceProfile, s.week)),
      hr: g.hr_zone ? `${g.hr_zone} ${formatHr(resolveHr(g.hr_zone, snap.lthr))}` : undefined,
      catatan: g.note ?? g.target_note ?? undefined,
    })),
    catatan: s.notes,
  };
}

function logSummary(l: WorkoutLog) {
  const sensor = sensorCheck(l);
  return {
    id: l.id, date: l.date, session: l.session_key, km: +(l.distance_m / 1000).toFixed(2),
    durasi_min: +(l.duration_s / 60).toFixed(1), pace: l.avg_pace_s ? formatPace(l.avg_pace_s) : null,
    avg_hr: l.avg_hr, max_hr: l.max_hr, hr_source: l.hr_source, cadence: l.avg_cadence, rpe: l.rpe,
    reps: l.reps.length ? l.reps.map((r) => ({
      ke: r.index, selesai: r.completed, pace: r.pace_s ? formatPace(r.pace_s) : null, hr: r.avg_hr ?? null,
      stop: r.stop_reason ?? null, stop_at_s: r.stop_at_s ?? null,
    })) : undefined,
    zona_menit: l.time_in_zone
      ? Object.fromEntries(Object.entries(l.time_in_zone).map(([k, v]) => [k, Math.round(v / 6) / 10])) : null,
    hr_drop_1min: l.hr_drop_1min, tidak_nyaman_di_hr: l.discomfort_at_hr.flag ? l.discomfort_at_hr.bpm : null,
    rep_tidak_selesai: l.rep_incomplete, suhu: l.temp_c, kelembapan: l.humidity,
    nyeri: l.pain.score ? l.pain : null, red_flags: l.red_flags.length ? l.red_flags : undefined,
    keselamatan: l.safety.level !== "ok" ? l.safety : undefined,
    sensor_curiga: sensor.suspect ? sensor.reason : undefined,
    catatan: l.notes,
  };
}

// ------------------------------------------------------------------ definisi tool
interface ToolDef<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<unknown>;
}
const tool = <S extends z.ZodType>(t: ToolDef<S>) => t;

export const TOOLS = [
  tool({
    name: "get_athlete_profile",
    description: "Profil atlet: target race, LTHR & zona HR (bpm), pace profile per kode intensitas, hari lari, kendala, status hold red flag. Panggil sekali di awal percakapan yang menyangkut latihan.",
    schema: z.object({}),
    async run(_i, ctx) {
      const st = await state(ctx);
      const snap = st.snapshot;
      const fmt = (o: Partial<Record<string, [number, number]>>) =>
        Object.fromEntries(Object.entries(o).filter(([, v]) => v).map(([k, v]) => [k, formatPaceRange(v!)]));
      return {
        atlet: meta.athlete, basis: "BSD (datar, panas & lembap)",
        race: { ...meta.race, goal: "sub-1:45", goal_pace: formatPace(meta.race.goal_pace_s) },
        program_mulai: meta.program_start, minggu_ke: weekNow(st), hari_lari: "Sel, Rab, Kam, Sab (long), Min; gym 4×/minggu",
        lthr: snap.lthr, lthr_sumber: snap.lthrSource === "test" ? "hasil tes" : "estimasi (diganti tes W05)",
        zona_hr: zoneTable(snap.lthr).map((z) => ({ zona: z.zone, pct_lthr: z.pct, bpm: formatHr(z.bpm) })),
        pace_profile: fmt(snap.paceProfile.default), pace_base_W03_W08: fmt(snap.paceProfile.base_phase),
        kendala: "HR ±170 terasa tidak nyaman. HR dari jam Huawei di pergelangan (rawan cadence lock).",
        hold_red_flag: computeHold(st),
        versi_plan: snap.version,
      };
    },
  }),
  tool({
    name: "get_plan",
    description: "Sesi terencana (versi plan aktif) dengan pace & HR terselesaikan. Default: hari ini s.d. +7 hari. Maksimal rentang 28 hari, atau satu minggu program (week 1–27).",
    schema: z.object({ from: iso.optional(), to: iso.optional(), week: z.number().int().min(1).max(27).optional() }),
    async run(i, ctx) {
      const st = await state(ctx);
      let list: Session[];
      if (i.week) list = st.snapshot.sessions.filter((s) => s.week === i.week);
      else {
        const from = i.from ?? st.today;
        const to = i.to ?? addDays(from, 7);
        if (daysBetween(from, to) > 28) return { error: "Rentang maksimal 28 hari" };
        list = st.snapshot.sessions.filter((s) => s.date >= from && s.date <= to);
      }
      const weeks = [...new Set(list.map((s) => s.week))].map((w) => {
        const wk = st.snapshot.weeks.find((x) => x.week === w)!;
        return { week: w, mulai: wk.start, fase: wk.phase, recovery: wk.is_recovery_week, taper: wk.is_taper, km: weekKm(st.snapshot, w) };
      });
      return { hari_ini: st.today, minggu: weeks, sesi: list.map((s) => sessionSummary(s, st)) };
    },
  }),
  tool({
    name: "get_logs",
    description: "Log latihan (terbaru dulu), termasuk reps, zona HR, RPE, nyeri, red flag, dan tanda sensor curiga (cadence lock).",
    schema: z.object({ from: iso.optional(), to: iso.optional(), limit: z.number().int().min(1).max(20).default(10) }),
    async run(i, ctx) {
      const st = await state(ctx);
      const logs = st.logs
        .filter((l) => (!i.from || l.date >= i.from) && (!i.to || l.date <= i.to))
        .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
        .slice(0, i.limit);
      return { jumlah: logs.length, logs: logs.map(logSummary) };
    },
  }),
  tool({
    name: "get_metrics",
    description: "Ringkasan beban: km rencana vs aktual per minggu, menit Z4 aktual, ACWR, rata-rata pace/HR easy run.",
    schema: z.object({ weeks: z.number().int().min(1).max(8).default(4) }),
    async run(i, ctx) {
      const st = await state(ctx);
      const nowWeek = weekNow(st);
      const rows = [];
      for (let w = Math.max(1, nowWeek - i.weeks + 1); w <= Math.max(1, nowWeek); w++) {
        const wk = st.snapshot.weeks.find((x) => x.week === w);
        if (!wk) continue;
        const end = addDays(wk.start, 6);
        const logs = st.logs.filter((l) => l.date >= wk.start && l.date <= end);
        const easy = logs.filter((l) => {
          const s = sessionOf(st.snapshot, l);
          return s && !s.is_hard && !s.type.startsWith("long") && l.avg_hr != null && !sensorCheck(l).suspect;
        });
        rows.push({
          week: w, fase: wk.phase, km_rencana: weekKm(st.snapshot, w),
          km_aktual: +(logs.reduce((a, l) => a + l.distance_m, 0) / 1000).toFixed(1), sesi_dilog: logs.length,
          z4_menit: Math.round(logs.reduce((a, l) => a + (l.time_in_zone?.Z4 ?? 0), 0) / 60),
          easy_avg_hr: easy.length ? Math.round(easy.reduce((a, l) => a + l.avg_hr!, 0) / easy.length) : null,
          easy_avg_pace: easy.length ? formatPace(easy.reduce((a, l) => a + (l.avg_pace_s ?? 0), 0) / easy.length) : null,
        });
      }
      const a = acwr(st.logs, st.today);
      return { minggu_ini: nowWeek, per_minggu: rows, acwr: { ...a, ratio: a.ratio == null ? null : +a.ratio.toFixed(2), batas_aman: "0,8–1,3" } };
    },
  }),
  tool({
    name: "get_readiness",
    description: "Kesiapan harian dari check-in pagi (HR istirahat vs rata-rata 7 hari, tidur, pegal, nyeri), penyesuaian panas, dan status hold.",
    schema: z.object({ date: iso.optional() }),
    async run(i, ctx) {
      const st = await state(ctx);
      const date = i.date ?? st.today;
      const c = st.checkins.find((x) => x.date === date) ?? null;
      return {
        tanggal: date, checkin: c, readiness: c ? readiness(st, date) : "belum check-in",
        penyesuaian_panas_dtk_per_km: c ? heatAdjustment(c.temp_c, c.humidity) : null,
        hold_red_flag: computeHold(st),
      };
    },
  }),
  tool({
    name: "get_z4_tolerance",
    description: "Toleransi Z4 (inti masalah HR 170): sesi kualitas terakhir — menit Z4 rencana vs aktual, rep selesai/berhenti dan alasannya, kegagalan tangga, plus target tangga sesi berikutnya.",
    schema: z.object({ limit: z.number().int().min(1).max(12).default(6) }),
    async run(i, ctx) {
      const st = await state(ctx);
      const snap = st.snapshot;
      const quality = st.logs
        .map((l) => ({ l, s: sessionOf(snap, l) }))
        .filter((x): x is { l: WorkoutLog; s: Session } => !!x.s && QUALITY_TYPES.includes(x.s.type))
        .sort((a, b) => b.l.date.localeCompare(a.l.date))
        .slice(0, i.limit)
        .map(({ l, s }) => {
          const q = assessQuality(l, s, snap.paceProfile, snap.lthr);
          return {
            date: l.date, session: s.id, type: s.type, z4_rencana_min: s.z4_target_min ?? Math.round(plannedZ4Minutes(s, snap.paceProfile)),
            z4_aktual_min: l.time_in_zone ? Math.round(l.time_in_zone.Z4 / 60) : null,
            reps_selesai: `${l.reps.filter((r) => r.completed).length}/${l.reps.length || "?"}`,
            berhenti: l.reps.filter((r) => !r.completed).map((r) => ({ rep: r.index, alasan: r.stop_reason, detik_ke: r.stop_at_s })),
            tidak_nyaman_di_hr: l.discomfort_at_hr.flag ? l.discomfort_at_hr.bpm : null,
            gagal: q.failed ? q.reasons : false, gagal_tangga: q.ladderFailure, panas: q.hot,
            sensor_curiga: sensorCheck(l).suspect,
          };
        });
      const next = snap.sessions.find((s) => isActive(s) && s.date >= st.today && LADDER_TYPES.includes(s.type));
      return {
        sesi_kualitas: quality,
        tangga_berikutnya: next ? { id: next.id, date: next.date, type: next.type, z4_target_min: next.z4_target_min } : null,
      };
    },
  }),
  tool({
    name: "log_workout",
    description: "Simpan log lari yang DICERITAKAN atlet di chat (hanya setelah atlet setuju dicatat). Engine adaptif langsung berjalan setelahnya. Jangan mengarang angka yang tidak disebut atlet.",
    schema: z.object({
      date: iso,
      session_id: z.string().regex(/^W\d{2}-(mon|tue|wed|thu|fri|sat|sun)$/).nullable().default(null),
      distance_km: z.number().min(0.1).max(60),
      duration_min: z.number().min(1).max(600),
      avg_hr: z.number().int().min(40).max(230).nullable().default(null),
      max_hr: z.number().int().min(40).max(240).nullable().default(null),
      hr_source: z.enum(["chest", "wrist"]).default("wrist"),
      avg_cadence: z.number().int().min(60).max(260).nullable().default(null),
      rpe: z.number().int().min(1).max(10),
      rep_incomplete: z.boolean().default(false),
      discomfort_at_hr_bpm: z.number().int().min(40).max(230).nullable().default(null),
      pain_score: z.number().int().min(0).max(10).default(0),
      pain_location: z.string().max(80).nullable().default(null),
      notes: z.string().max(2000).nullable().default(null),
    }),
    async run(i, ctx) {
      const input: WorkoutLogInput = {
        date: i.date, session_key: i.session_id, distance_m: Math.round(i.distance_km * 1000),
        duration_s: Math.round(i.duration_min * 60), avg_hr: i.avg_hr, max_hr: i.max_hr, hr_source: i.hr_source,
        avg_cadence: i.avg_cadence, rpe: i.rpe, reps: [], time_in_zone: null, hr_drop_1min: null,
        discomfort_at_hr: { flag: i.discomfort_at_hr_bpm != null, bpm: i.discomfort_at_hr_bpm },
        rep_incomplete: i.rep_incomplete, temp_c: null, humidity: null,
        pain: { score: i.pain_score, location: i.pain_location, sharp: false },
        red_flags: [], notes: i.notes, source: "manual", external_id: null, streams: null,
      };
      const r = await ctx.deps.saveLog(input);
      fresh(ctx);
      ctx.effects.push({ kind: "log", id: r.log.id, title: `Log ${i.date} · ${i.distance_km} km` });
      return { tersimpan: !r.duplicate, duplikat: r.duplicate, log_id: r.log.id, keselamatan: r.log.safety, engine: r.outcome };
    },
  }),
  tool({
    name: "propose_plan_change",
    description:
      "Usulkan perubahan plan. Pilih SATU aksi: make_easy (sesi → easy), reduce_volume (factor 0.5–0.95), split_reps (tempo/HM pace dipecah, total Z4 tetap), rest, move (to_date dalam minggu yang sama; aturan 48 jam & bukan H-1 long run), shift_pace (codes + delta_s; positif = lebih lambat). " +
      "Usulan disimpan sebagai pending dan divalidasi guardrail (maks 2 sesi keras/minggu, tidak 2 hari keras berturut-turut, volume +10%, taper). Hasil memberi size: small boleh diterapkan dengan apply_plan_change setelah atlet setuju; large hanya bisa disetujui atlet lewat tombol di aplikasi.",
    schema: z.object({ change: coachActionSchema, reason: z.string().min(5).max(500) }),
    async run(i, ctx) {
      const st = await state(ctx);
      if (computeHold(st).active) return { error: "Program sedang ditahan karena red flag. Tidak ada perubahan latihan sampai atlet menyatakan sudah diperiksa dokter." };
      const built = buildCoachAction(st.snapshot, i.change, st.today);
      if (!built.ok) return { error: built.error };
      const rec = await ctx.deps.propose({ title: built.title, reason: i.reason, changes: built.changes, size: built.size });
      fresh(ctx);
      ctx.effects.push({ kind: "proposal", id: rec.id, title: rec.title, mode: rec.mode, size: rec.size });
      return {
        change_id: rec.id, status: rec.mode, size: rec.size, judul: rec.title,
        diff: rec.diff.map((d) => `${d.label}: ${d.before} → ${d.after}`),
        ditolak_guardrail: rec.blocked_by,
      };
    },
  }),
  tool({
    name: "apply_plan_change",
    description: "Terapkan usulan coach berukuran small yang statusnya pending — HANYA setelah atlet menyetujuinya di chat. Usulan large akan ditolak (atlet harus menekan Setujui di aplikasi).",
    schema: z.object({ change_id: z.string().min(1) }),
    async run(i, ctx) {
      try {
        const r = await ctx.deps.apply(i.change_id);
        fresh(ctx);
        if (r.ok) ctx.effects.push({ kind: "applied", id: i.change_id, title: "Perubahan diterapkan" });
        return r;
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  }),
  tool({
    name: "recalc_from_test",
    description: "Hitung ulang LTHR & pace dari tes 30 menit atau 10K time trial (R5). Menghasilkan usulan large (sebelum/sesudah) yang harus disetujui atlet; ada opsi 'LTHR saja'.",
    schema: z.object({
      type: z.enum(["30min", "10k_tt"]), date: iso, distance_km: z.number().min(3).max(15),
      duration_min: z.number().min(15).max(90), avg_hr_last20: z.number().int().min(100).max(220).nullable(),
    }),
    async run(i, ctx) {
      const rec = await ctx.deps.submitTest({
        type: i.type, date: i.date, distance_m: Math.round(i.distance_km * 1000),
        duration_s: Math.round(i.duration_min * 60), avg_hr_last20: i.avg_hr_last20,
      });
      fresh(ctx);
      ctx.effects.push({ kind: "test", id: rec.id, title: rec.title, mode: rec.mode, size: rec.size });
      return {
        change_id: rec.id, status: rec.mode, judul: rec.title, alasan: rec.reason,
        diff: rec.diff.map((d) => `${d.label}: ${d.before} → ${d.after}`),
        opsi: rec.alternatives?.map((a) => a.label),
      };
    },
  }),
  tool({
    name: "explain_session",
    description: "Detail satu sesi (berdasarkan session_id atau tanggal): segmen, pace, HR, tujuan, dan cue HR 170 bila sesi kualitas.",
    schema: z.object({ session_id: z.string().optional(), date: iso.optional() }),
    async run(i, ctx) {
      const st = await state(ctx);
      const s = i.session_id
        ? st.snapshot.sessions.find((x) => x.id === i.session_id)
        : st.snapshot.sessions.find((x) => x.date === (i.date ?? st.today) && isActive(x));
      if (!s) return { error: "Tidak ada sesi lari di tanggal itu (hari istirahat/gym, atau id salah)." };
      return {
        ...sessionSummary(s, st),
        tujuan: PURPOSE[s.type],
        teks_asli_excel: s.source_text,
        cue_hr170: QUALITY_TYPES.includes(s.type) ? CUES_HR170 : undefined,
      };
    },
  }),
];

const PURPOSE: Record<Session["type"], string> = {
  easy: "Basis aerobik; HR Z2, napas bisa ngobrol.",
  easy_strides: "Easy + strides untuk ekonomi lari & cadence tanpa beban metabolik.",
  easy_hill: "Easy + sprint tanjakan pendek untuk kekuatan & rekrutmen otot; recovery penuh antar rep.",
  recovery: "Pemulihan aktif; sangat pelan, Z1.",
  vo2_4x4: "VO2max (Norwegian 4×4): Z4–Z5 tinggi, recovery jog 3′.",
  tempo: "Threshold: membangun toleransi di Z4 (tangga menit Z4) — inti target sub-1:45.",
  hm_pace: "Membiasakan pace race 4:55–5:00/km.",
  fartlek: "Variasi ringan, berdasarkan rasa — bukan sesi keras.",
  test_30min: "Tes LTHR: avg HR 20 menit terakhir = LTHR baru.",
  tt_10k: "Time trial 10K untuk kalibrasi VDOT & pace.",
  long: "Daya tahan aerobik.",
  long_with_pace: "Long run dengan blok pace race di akhir.",
  long_progressive: "Long run progresif — akhir mendekati pace M/H.",
  long_race_sim: "Simulasi race: perlengkapan, nutrisi, pacing.",
  shakeout: "Shake-out H-1: pendek & ringan.",
  race: "Race day.",
};

function weekNow(st: EngineState) {
  const w = st.snapshot.weeks.slice().reverse().find((x) => x.start <= st.today);
  return w?.week ?? 0;
}

// ------------------------------------------------------------------ untuk API Anthropic
export const toolDefinitions: Anthropic.Tool[] = TOOLS.map((t) => {
  const { $schema: _drop, ...schema } = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>;
  void _drop;
  return { name: t.name, description: t.description, input_schema: schema as Anthropic.Tool["input_schema"] };
});

export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { content: `Tool tidak dikenal: ${name}`, isError: true };
  const parsed = t.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { content: `Input tidak valid: ${z.prettifyError(parsed.error)}`, isError: true };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await t.run(parsed.data as any, ctx);
    const isError = !!out && typeof out === "object" && "error" in out;
    return { content: JSON.stringify(out), isError };
  } catch (e) {
    return { content: `Gagal: ${(e as Error).message}`, isError: true };
  }
}
