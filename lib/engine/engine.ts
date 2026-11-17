// Orkestrator engine: jalankan rules → dedupe → resolusi konflik → ukuran → validasi guardrail.
import type { Change, EngineResult, EngineState, PlanSnapshot, Proposal, Size, Trigger } from "./model";
import { applyChanges, diffSnapshots, inverseOf } from "./snapshot";
import { validateChange } from "./guardrails";
import { computeHold, r01, r02, r03, r04, r06, r07, r08acwr, r09, r10, r12, r13, type RuleOut } from "./rules";

/** Prioritas: angka kecil menang bila dua rule menyentuh sesi yang sama. */
const PRIORITY: Record<string, number> = {
  R10: 0, R6: 1, R12: 2, R7: 3, R3: 4, R8: 5, R1: 6, R2: 7, R4: 8, R5: 9, manual: 10,
};

/** Ukuran minimum menurut aturan "kecil vs besar" di SPEC. */
export function computeSize(before: PlanSnapshot, changes: Change[]): Size {
  for (const ch of changes) {
    if (ch.op === "set_lthr" || ch.op === "set_pace_profile") return "large";
    if (ch.op === "shift_pace" && Math.abs(ch.delta_s) > 10) return "large";
    if (ch.op === "update_session") {
      const old = before.sessions.find((s) => s.id === ch.id);
      if (!old) return "large";
      if (ch.patch.date && ch.patch.date !== old.date) return "large";
      if (ch.patch.status && ch.patch.status !== "planned") return "large";
      if (ch.patch.is_hard && !old.is_hard) return "large";
      if (ch.patch.planned_km != null && ch.patch.planned_km > old.planned_km * 1.2 + 0.05) return "large";
    }
  }
  return "small";
}

export function run(state: EngineState, trigger: Trigger): EngineResult {
  const hold = computeHold(state);
  if (hold.active) {
    // Red flag: STOP. Tidak ada saran/penyesuaian latihan sampai user menyatakan sudah diperiksa.
    return {
      proposals: [], blocked: [], annotations: r13(state, trigger).annotations, hold,
      notices: [{
        key: `R10-stop:${hold.since}`, rule: "R10", level: "stop", date: state.today,
        message: `Red flag tercatat (${hold.reasons.join(", ")}). STOP latihan dan periksa ke dokter (EKG / treadmill test). Program ditahan sampai kamu menandai sudah diperiksa.`,
      }],
    };
  }

  const outs: RuleOut[] = [r13, r10, r06, r12, r07, r03, r08acwr, r01, r02, r04, r09].map((f) => f(state, trigger));
  const notices = outs.flatMap((o) => o.notices);
  const annotations = outs.flatMap((o) => o.annotations);
  const seen = new Set(state.changes.map((c) => c.key));
  const seenNotice = new Set<string>();

  let proposals = outs.flatMap((o) => o.proposals).filter((p) => !seen.has(p.key));
  proposals.sort((a, b) => PRIORITY[a.rule] - PRIORITY[b.rule]);

  // resolusi konflik: satu sesi hanya disentuh rule berprioritas tertinggi
  const taken = new Set<string>();
  proposals = proposals.filter((p) => {
    const t = p.targets ?? p.changes.flatMap((c) => (c.op === "update_session" ? [c.id] : []));
    if (t.some((id) => taken.has(id))) return false;
    t.forEach((id) => taken.add(id));
    return true;
  });

  // ukuran + validasi guardrail, berurutan (perubahan kecil langsung "diterapkan" ke snapshot kerja)
  const accepted: Proposal[] = [];
  const blocked: EngineResult["blocked"] = [];
  let cur = state.snapshot;
  for (const p of proposals) {
    const computed = computeSize(cur, p.changes);
    const size: Size = p.size === "large" || computed === "large" ? "large" : "small";
    const after = applyChanges(cur, p.changes);
    const v = validateChange(cur, after, p.changes, state.today);
    if (!v.ok) {
      blocked.push({ proposal: { ...p, size }, violations: v.violations });
      continue;
    }
    accepted.push({ ...p, size });
    if (size === "small") cur = after;
  }

  return {
    proposals: accepted,
    blocked,
    notices: notices.filter((n) => (seenNotice.has(n.key) ? false : (seenNotice.add(n.key), true))),
    annotations,
    hold,
  };
}

/** Terapkan proposal ke snapshot → snapshot baru + diff + inverse (untuk revert). */
export function applyProposal(snapshot: PlanSnapshot, changes: Change[]) {
  const after = applyChanges(snapshot, changes);
  return {
    after: { ...after, version: snapshot.version + 1 },
    diff: diffSnapshots(snapshot, after),
    inverse: inverseOf(snapshot, changes),
  };
}

export { validateChange };
