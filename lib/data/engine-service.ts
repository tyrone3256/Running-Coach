import "server-only";
import { randomUUID } from "node:crypto";
import { getStore } from "./store";
import { getPlanStore } from "./plan-store";
import { applyProposal, run, validateChange } from "@/lib/engine/engine";
import { r05FromTest, type TestInput } from "@/lib/engine/rules";
import type { Change, EngineResult, EngineState, PlanChangeRecord, Proposal, Trigger } from "@/lib/engine/model";
import { todayIso } from "@/lib/dates";

export interface EngineOutcome {
  applied: PlanChangeRecord[];
  pending: PlanChangeRecord[];
  blocked: PlanChangeRecord[];
  notices: EngineResult["notices"];
  hold: EngineResult["hold"];
}

export async function loadState(today = todayIso()): Promise<EngineState> {
  const store = getStore();
  const ps = getPlanStore();
  const [snapshot, logs, checkins, changes, clearances] = await Promise.all([
    ps.getActive(),
    store.listLogs(),
    store.listCheckins("2000-01-01", "2100-12-31"), // satu pengguna: data kecil, muat semua
    ps.listChanges(),
    ps.listClearances(),
  ]);
  return { today, snapshot, logs, checkins, changes, clearances };
}

function record(p: Proposal, mode: PlanChangeRecord["mode"], today: string, extra: Partial<PlanChangeRecord> = {}): PlanChangeRecord {
  return {
    id: randomUUID(), key: p.key, rule: p.rule, size: p.size, title: p.title, reason: p.reason, changes: p.changes,
    inverse: null, diff: [], evidence: p.evidence, alternatives: p.alternatives, cues: p.cues, mode,
    from_version: null, to_version: null, reverted_by: null, reverts: null,
    created_at: new Date().toISOString(), date: today, ...extra,
  };
}

/** Terapkan perubahan ke plan aktif sebagai versi baru (validasi ulang guardrail). */
async function applyToActive(changes: Change[], reason: string, today: string) {
  const ps = getPlanStore();
  const before = await ps.getActive();
  const { after, diff, inverse } = applyProposal(before, changes);
  const v = validateChange(before, after, changes, today);
  if (!v.ok) return { ok: false as const, violations: v.violations };
  await ps.saveVersion(after, reason);
  return { ok: true as const, diff, inverse, from: before.version, to: after.version };
}

export async function processTrigger(trigger: Trigger, today = todayIso()): Promise<EngineOutcome> {
  const state = await loadState(today);
  const res = run(state, trigger);
  const store = getStore();
  const ps = getPlanStore();
  for (const a of res.annotations) {
    await store.annotateLog(a.log_id, { sensor_suspect: a.sensor_suspect, sensor_suspect_reason: a.reason });
  }
  const out: EngineOutcome = { applied: [], pending: [], blocked: [], notices: res.notices, hold: res.hold };
  for (const p of res.proposals) {
    if (p.size === "small") {
      const r = await applyToActive(p.changes, `${p.rule}: ${p.title}`, today);
      if (r.ok) {
        const rec = record(p, "auto", today, { diff: r.diff, inverse: r.inverse, from_version: r.from, to_version: r.to });
        await ps.saveChange(rec);
        out.applied.push(rec);
      } else {
        const rec = record(p, "blocked", today, { blocked_by: r.violations });
        await ps.saveChange(rec);
        out.blocked.push(rec);
      }
    } else {
      const preview = applyProposal(state.snapshot, p.changes);
      const rec = record(p, "pending", today, { diff: preview.diff });
      await ps.saveChange(rec);
      out.pending.push(rec);
    }
  }
  for (const b of res.blocked) {
    const rec = record(b.proposal, "blocked", today, { blocked_by: b.violations });
    await ps.saveChange(rec);
    out.blocked.push(rec);
  }
  await ps.saveNotices(res.notices);
  return out;
}

export async function approveChange(id: string, alternativeId?: string | null) {
  const ps = getPlanStore();
  const c = await ps.getChange(id);
  if (!c || c.mode !== "pending") throw new Error("Perubahan tidak ditemukan / sudah diproses");
  const changes = alternativeId ? c.alternatives?.find((a) => a.id === alternativeId)?.changes : c.changes;
  if (!changes) throw new Error("Opsi tidak dikenal");
  const today = todayIso();
  const r = await applyToActive(changes, `${c.rule}: ${c.title}${alternativeId ? ` (${alternativeId})` : ""}`, today);
  if (!r.ok) {
    await ps.updateChange(id, { mode: "blocked", blocked_by: r.violations });
    return { ok: false, violations: r.violations };
  }
  await ps.updateChange(id, {
    mode: "approved", changes, diff: r.diff, inverse: r.inverse, from_version: r.from, to_version: r.to,
    title: alternativeId ? `${c.title} — ${c.alternatives?.find((a) => a.id === alternativeId)?.label}` : c.title,
  });
  return { ok: true };
}

export async function rejectChange(id: string) {
  const ps = getPlanStore();
  const c = await ps.getChange(id);
  if (!c || c.mode !== "pending") throw new Error("Perubahan tidak ditemukan / sudah diproses");
  await ps.updateChange(id, { mode: "rejected" });
}

export async function revertChange(id: string) {
  const ps = getPlanStore();
  const c = await ps.getChange(id);
  if (!c || !(c.mode === "auto" || c.mode === "approved") || c.reverted_by || !c.inverse) {
    throw new Error("Perubahan ini tidak bisa di-revert");
  }
  const today = todayIso();
  const r = await applyToActive(c.inverse, `revert ${c.rule}: ${c.title}`, today);
  if (!r.ok) return { ok: false, violations: r.violations };
  const rec: PlanChangeRecord = {
    id: randomUUID(), key: `revert:${c.id}`, rule: "manual", size: c.size, title: `Revert: ${c.title}`,
    reason: "Dibatalkan oleh kamu.", changes: c.inverse, inverse: r.inverse, diff: r.diff, mode: "approved",
    from_version: r.from, to_version: r.to, reverted_by: null, reverts: c.id,
    created_at: new Date().toISOString(), date: today,
  };
  await ps.saveChange(rec);
  await ps.updateChange(c.id, { reverted_by: rec.id });
  return { ok: true };
}

export async function submitTest(input: TestInput) {
  const state = await loadState();
  const p = r05FromTest(state, input);
  if (state.changes.some((c) => c.key === p.key && c.mode === "pending")) {
    return state.changes.find((c) => c.key === p.key)!;
  }
  const key = state.changes.some((c) => c.key === p.key) ? `${p.key}:${Date.now()}` : p.key;
  const preview = applyProposal(state.snapshot, p.changes);
  const rec = record({ ...p, key }, "pending", state.today, { diff: preview.diff });
  await getPlanStore().saveChange(rec);
  return rec;
}

export async function clearHold(note: string | null) {
  await getPlanStore().addClearance(new Date().toISOString(), note);
}
