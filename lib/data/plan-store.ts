import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import seed from "@/seed/plan.json";
import type { Notice, PlanChangeRecord, PlanSnapshot, SafetyEvent } from "@/lib/engine/model";
import type { PlanSeed } from "@/lib/engine/types";
import { normalizeSnapshot, seedRace, withRp } from "@/lib/plan/defaults";
import type { PlanningProfile } from "@/lib/plan/profile";
import { createSupabaseServer, currentUserId, supabaseConfigured } from "@/lib/supabase/server";
import { vdotFromRace } from "@/lib/engine/vdot";

export interface PlanStore {
  getActive(): Promise<PlanSnapshot>;
  saveVersion(snapshot: PlanSnapshot, reason: string): Promise<void>;
  listChanges(): Promise<PlanChangeRecord[]>;
  getChange(id: string): Promise<PlanChangeRecord | null>;
  saveChange(c: PlanChangeRecord): Promise<void>;
  updateChange(id: string, patch: Partial<PlanChangeRecord>): Promise<void>;
  listNotices(): Promise<Array<Notice & { created_at: string }>>;
  saveNotices(ns: Notice[]): Promise<void>;
  listClearances(): Promise<string[]>;
  addClearance(at: string, note: string | null): Promise<void>;
  listSafetyEvents(): Promise<SafetyEvent[]>;
  addSafetyEvent(e: SafetyEvent): Promise<void>;
  getPlanning(): Promise<PlanningProfile | null>;
  savePlanning(p: PlanningProfile): Promise<void>;
}

export function seedSnapshot(): PlanSnapshot {
  const p = seed as unknown as PlanSeed;
  return {
    version: 1,
    weeks: p.weeks,
    sessions: p.sessions,
    paceProfile: withRp({ ...p.pace_profile, vdot_ref: Math.round(vdotFromRace(p.meta.race.distance_m, p.meta.race.goal_time_s) * 10) / 10 }),
    lthr: p.meta.lthr,
    lthrSource: "estimate",
    races: [seedRace()],
  };
}

// ------------------------------------------------------------------ file
interface FileDb {
  versions: Array<{ snapshot: PlanSnapshot; reason: string; created_at: string }>;
  changes: PlanChangeRecord[];
  notices: Array<Notice & { created_at: string }>;
  clearances: Array<{ at: string; note: string | null }>;
  safety_events?: SafetyEvent[];
  planning?: PlanningProfile | null;
}

export function filePlanStore(dir = process.env.LOCAL_DATA_DIR ?? path.join(process.cwd(), ".local-data")): PlanStore {
  const file = path.join(dir, "plan.json");
  const load = async (): Promise<FileDb> => {
    try {
      return JSON.parse(await readFile(file, "utf-8")) as FileDb;
    } catch {
      return { versions: [], changes: [], notices: [], clearances: [], safety_events: [] };
    }
  };
  const save = async (db: FileDb) => {
    await mkdir(dir, { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(db), "utf-8");
    await rename(`${file}.tmp`, file);
  };
  return {
    async getActive() {
      const db = await load();
      return db.versions.length ? normalizeSnapshot(db.versions[db.versions.length - 1].snapshot) : seedSnapshot();
    },
    async saveVersion(snapshot, reason) {
      const db = await load();
      if (!db.versions.length) db.versions.push({ snapshot: seedSnapshot(), reason: "seed", created_at: new Date().toISOString() });
      db.versions.push({ snapshot, reason, created_at: new Date().toISOString() });
      await save(db);
    },
    async listChanges() {
      return (await load()).changes.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async getChange(id) {
      return (await load()).changes.find((c) => c.id === id) ?? null;
    },
    async saveChange(c) {
      const db = await load();
      db.changes.push(c);
      await save(db);
    },
    async updateChange(id, patch) {
      const db = await load();
      db.changes = db.changes.map((c) => (c.id === id ? { ...c, ...patch } : c));
      await save(db);
    },
    async listNotices() {
      return (await load()).notices.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async saveNotices(ns) {
      if (!ns.length) return;
      const db = await load();
      const keys = new Set(db.notices.map((n) => n.key));
      for (const n of ns) if (!keys.has(n.key)) db.notices.push({ ...n, created_at: new Date().toISOString() });
      await save(db);
    },
    async listClearances() {
      return (await load()).clearances.map((c) => c.at);
    },
    async addClearance(at, note) {
      const db = await load();
      db.clearances.push({ at, note });
      await save(db);
    },
    async listSafetyEvents() {
      return (await load()).safety_events ?? [];
    },
    async addSafetyEvent(e) {
      const db = await load();
      (db.safety_events ??= []).push(e);
      await save(db);
    },
    async getPlanning() {
      return (await load()).planning ?? null;
    },
    async savePlanning(p) {
      const db = await load();
      db.planning = p;
      await save(db);
    },
  };
}

// ------------------------------------------------------------------ Supabase
function supabasePlanStore(): PlanStore {
  const db = () => createSupabaseServer();
  const uid = currentUserId;
  const check = <T,>(res: { data: T; error: unknown }) => {
    if (res.error) throw new Error(JSON.stringify(res.error));
    return res.data;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Row = Record<string, any>;
  const toChange = (r: Row): PlanChangeRecord => ({
    id: r.id, key: r.key, rule: r.rule_id, size: r.size, title: r.title, reason: r.reason, changes: r.changes ?? [],
    inverse: r.inverse, diff: r.diff ?? [], evidence: r.evidence ?? undefined, alternatives: r.alternatives ?? undefined,
    cues: r.cues ?? undefined, mode: r.mode, blocked_by: r.blocked_by ?? undefined, from_version: r.from_version,
    to_version: r.to_version, reverted_by: r.reverted_by, reverts: r.reverts, created_at: r.created_at, date: r.date,
  });
  const fromChange = (c: PlanChangeRecord) => ({
    id: c.id, key: c.key, rule_id: c.rule, size: c.size, title: c.title, reason: c.reason, changes: c.changes,
    inverse: c.inverse, diff: c.diff, evidence: c.evidence ?? null, alternatives: c.alternatives ?? null, cues: c.cues ?? null,
    mode: c.mode, blocked_by: c.blocked_by ?? null, from_version: c.from_version, to_version: c.to_version,
    reverted_by: c.reverted_by, reverts: c.reverts, created_at: c.created_at, date: c.date,
  });

  return {
    async getActive() {
      const client = await db();
      const pv = check(await client.from("plan_versions").select("id, version, meta").eq("is_active", true).maybeSingle()) as Row | null;
      if (!pv) return seedSnapshot();
      const [pace, hr, weeks, sessions] = await Promise.all([
        client.from("pace_profile").select("*").order("version", { ascending: false }).limit(1).single(),
        client.from("hr_profile").select("*").order("version", { ascending: false }).limit(1).single(),
        client.from("plan_weeks").select("*").eq("plan_version_id", pv.id).order("week"),
        client.from("sessions").select("*").eq("plan_version_id", pv.id).order("date"),
      ]).then((rs) => rs.map((r) => check(r as { data: unknown; error: unknown })) as Row[]);
      const ss = (sessions as unknown as Row[]).map((s) => ({
        id: s.key, date: s.date, week: s.week, day: s.day, phase: s.phase, type: s.type, is_hard: s.is_hard,
        planned_km: Number(s.planned_km), z4_target_min: s.z4_target_min, z4_planned_min: s.z4_planned_min,
        mp_hmp_km: null, segments_km: Number(s.planned_km), segments: s.segments, notes: s.notes ?? [],
        source_text: s.source_text ?? "", status: s.status === "planned" ? undefined : s.status, moved_from: s.moved_from,
      }));
      return normalizeSnapshot({
        version: pv.version,
        races: (pv.meta as Row | null)?.races ?? [],
        weeks: (weeks as unknown as Row[]).map((w) => ({
          week: w.week, start: w.start_date, phase: w.phase, is_recovery_week: w.is_recovery_week, is_taper: w.is_taper,
          planned_km: Number(w.planned_km), color: w.color, guardrail_exception: w.guardrail_exception,
          hard_sessions: ss.filter((s) => s.week === w.week && s.is_hard && !s.status).map((s) => s.day),
        })),
        sessions: ss,
        paceProfile: (() => {
          const { vdot_ref, ...bp } = (pace.base_phase ?? {}) as Row;
          return { version: pace.version, default: pace.codes, base_phase: bp, vdot_ref: vdot_ref ?? undefined };
        })(),
        lthr: hr.lthr,
        lthrSource: hr.source,
      } as PlanSnapshot);
    },
    async saveVersion(snap, reason) {
      const client = await db();
      const user_id = await uid();
      const cur = await this.getActive();
      const pv = check(await client.from("plan_versions").insert({
        user_id, version: snap.version, parent_version: cur.version, reason, is_active: false, meta: { races: snap.races },
      }).select("id").single()) as Row;
      check(await client.from("plan_weeks").insert(snap.weeks.map((w) => ({
        user_id, plan_version_id: pv.id, week: w.week, start_date: w.start, phase: w.phase,
        is_recovery_week: w.is_recovery_week, is_taper: w.is_taper, planned_km: w.planned_km, color: w.color,
        guardrail_exception: w.guardrail_exception,
      }))));
      check(await client.from("sessions").insert(snap.sessions.map((s) => ({
        user_id, plan_version_id: pv.id, key: s.id, date: s.date, week: s.week, day: s.day, phase: s.phase, type: s.type,
        segments: s.segments, planned_km: s.planned_km, is_hard: s.is_hard, z4_target_min: s.z4_target_min,
        z4_planned_min: s.z4_planned_min, notes: s.notes, source_text: s.source_text, status: s.status ?? "planned",
        moved_from: s.moved_from ?? null,
      }))));
      if (JSON.stringify(snap.paceProfile) !== JSON.stringify(cur.paceProfile)) {
        check(await client.from("pace_profile").insert({
          user_id, version: snap.paceProfile.version, valid_from: new Date().toISOString().slice(0, 10),
          codes: snap.paceProfile.default, base_phase: { ...snap.paceProfile.base_phase, vdot_ref: snap.paceProfile.vdot_ref },
          source: "rule",
        }));
      }
      if (snap.lthr !== cur.lthr) {
        const last = check(await client.from("hr_profile").select("version").order("version", { ascending: false }).limit(1).single()) as Row;
        check(await client.from("hr_profile").insert({
          user_id, version: last.version + 1, valid_from: new Date().toISOString().slice(0, 10), lthr: snap.lthr, source: snap.lthrSource,
        }));
      }
      check(await client.from("plan_versions").update({ is_active: false }).eq("is_active", true));
      check(await client.from("plan_versions").update({ is_active: true }).eq("id", pv.id));
    },
    async listChanges() {
      return ((check(await (await db()).from("plan_changes").select("*").order("created_at", { ascending: false })) ?? []) as Row[]).map(toChange);
    },
    async getChange(id) {
      const r = check(await (await db()).from("plan_changes").select("*").eq("id", id).maybeSingle()) as Row | null;
      return r ? toChange(r) : null;
    },
    async saveChange(c) {
      check(await (await db()).from("plan_changes").insert({ ...fromChange(c), user_id: await uid() }));
    },
    async updateChange(id, patch) {
      const full = { ...(await this.getChange(id))!, ...patch };
      const row = fromChange(full);
      check(await (await db()).from("plan_changes").update(row).eq("id", id));
    },
    async listNotices() {
      return (check(await (await db()).from("engine_notices").select("*").order("created_at", { ascending: false })) ?? []) as Array<Notice & { created_at: string }>;
    },
    async saveNotices(ns) {
      if (!ns.length) return;
      const user_id = await uid();
      check(await (await db()).from("engine_notices").upsert(
        ns.map((n) => ({ user_id, key: n.key, rule: n.rule, level: n.level, message: n.message, log_id: n.log_id ?? null, date: n.date, cues: n.cues ?? null })),
        { onConflict: "user_id,key", ignoreDuplicates: true },
      ));
    },
    async listClearances() {
      return ((check(await (await db()).from("medical_clearances").select("cleared_at")) ?? []) as Row[]).map((r) => r.cleared_at);
    },
    async addClearance(at, note) {
      check(await (await db()).from("medical_clearances").insert({ user_id: await uid(), cleared_at: at, note }));
    },
    async listSafetyEvents() {
      return ((check(await (await db()).from("safety_events").select("*")) ?? []) as Row[])
        .map((r) => ({ created_at: r.created_at, date: r.date, reasons: r.reasons ?? [], source: r.source }));
    },
    async addSafetyEvent(e) {
      check(await (await db()).from("safety_events").insert({ user_id: await uid(), ...e }));
    },
    async getPlanning() {
      const r = check(await (await db()).from("athlete_profile").select("planning").maybeSingle()) as Row | null;
      return (r?.planning as PlanningProfile | null) ?? null;
    },
    async savePlanning(p) {
      check(await (await db()).from("athlete_profile").update({ planning: p, updated_at: new Date().toISOString() }).eq("user_id", await uid()));
    },
  };
}

export function getPlanStore(): PlanStore {
  if (supabaseConfigured()) return supabasePlanStore();
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_STORE !== "1") {
    throw new Error("Supabase belum dikonfigurasi.");
  }
  return filePlanStore();
}
