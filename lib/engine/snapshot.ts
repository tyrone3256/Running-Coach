// Terapkan perubahan ke snapshot (immutable), hitung inverse untuk revert, dan diff untuk UI.
import type { Change, DiffItem, PlanSnapshot, SessionPatch } from "./model";
import type { PacedCode, PaceProfile, Session } from "./types";
import { formatPaceRange, isPaced } from "./pace";
import { SESSION_LABEL } from "@/lib/labels";

export function isActive(s: Session): boolean {
  return !s.status || s.status === "planned";
}

function shiftProfile(p: PaceProfile, codes: PacedCode[], d: number): PaceProfile {
  const def = { ...p.default };
  const base = { ...p.base_phase };
  for (const c of codes) {
    def[c] = [def[c][0] + d, def[c][1] + d];
    const b = base[c];
    if (b) base[c] = [b[0] + d, b[1] + d];
  }
  return { ...p, version: p.version + 1, default: def, base_phase: base };
}

export function applyChange(s: PlanSnapshot, ch: Change): PlanSnapshot {
  switch (ch.op) {
    case "shift_pace":
      return { ...s, paceProfile: shiftProfile(s.paceProfile, ch.codes, ch.delta_s) };
    case "set_pace_profile":
      return {
        ...s,
        paceProfile: {
          ...s.paceProfile,
          version: s.paceProfile.version + 1,
          default: { ...s.paceProfile.default, ...ch.default },
          base_phase: { ...s.paceProfile.base_phase, ...ch.base_phase },
          ...(ch.vdot_ref ? { vdot_ref: ch.vdot_ref } : {}),
        },
      };
    case "set_lthr":
      return { ...s, lthr: ch.lthr, lthrSource: ch.source };
    case "update_session": {
      const idx = s.sessions.findIndex((x) => x.id === ch.id);
      if (idx < 0) throw new Error(`Sesi ${ch.id} tidak ada`);
      const sessions = [...s.sessions];
      sessions[idx] = { ...sessions[idx], ...ch.patch };
      sessions.sort((a, b) => a.date.localeCompare(b.date));
      return { ...s, sessions, weeks: recomputeWeeks(s, sessions) };
    }
  }
}

export function applyChanges(s: PlanSnapshot, changes: Change[]): PlanSnapshot {
  return changes.reduce(applyChange, s);
}

function recomputeWeeks(s: PlanSnapshot, sessions: Session[]) {
  return s.weeks.map((w) => {
    const ws = sessions.filter((x) => x.week === w.week && isActive(x));
    return {
      ...w,
      planned_km: Math.round(ws.reduce((a, x) => a + x.planned_km, 0) * 10) / 10,
      hard_sessions: ws.filter((x) => x.is_hard).map((x) => x.day),
    };
  });
}

/** Perubahan kebalikan, dihitung terhadap snapshot SEBELUM perubahan diterapkan. */
export function inverseOf(before: PlanSnapshot, changes: Change[]): Change[] {
  const inv: Change[] = [];
  let cur = before;
  for (const ch of changes) {
    switch (ch.op) {
      case "shift_pace":
        inv.unshift({ op: "shift_pace", codes: ch.codes, delta_s: -ch.delta_s });
        break;
      case "set_pace_profile": {
        const d: Partial<Record<PacedCode, [number, number]>> = {};
        const b: Partial<Record<PacedCode, [number, number]>> = {};
        for (const k of Object.keys(ch.default) as PacedCode[]) d[k] = cur.paceProfile.default[k];
        for (const k of Object.keys(ch.base_phase) as PacedCode[]) {
          const v = cur.paceProfile.base_phase[k];
          if (v) b[k] = v;
        }
        inv.unshift({ op: "set_pace_profile", default: d, base_phase: b, vdot_ref: cur.paceProfile.vdot_ref });
        break;
      }
      case "set_lthr":
        inv.unshift({ op: "set_lthr", lthr: cur.lthr, source: cur.lthrSource });
        break;
      case "update_session": {
        const old = cur.sessions.find((x) => x.id === ch.id)!;
        const patch: SessionPatch = {};
        for (const k of Object.keys(ch.patch) as Array<keyof SessionPatch>) {
          (patch as Record<string, unknown>)[k] = old[k] === undefined ? null : old[k];
        }
        if ("status" in patch && patch.status === null) patch.status = "planned";
        inv.unshift({ op: "update_session", id: ch.id, patch });
        break;
      }
    }
    cur = applyChange(cur, ch);
  }
  return inv;
}

function describeSession(s: Session | undefined): string {
  if (!s) return "—";
  if (!isActive(s)) return s.status === "rest" ? "REST" : "dilewati";
  const work = s.segments.find((g) => g.kind === "work" || g.kind === "test");
  let w = "";
  if (work) {
    const reps = (work.reps ?? 1) > 1 ? `${work.reps}×` : "";
    const size = work.duration_s && !work.distance_m ? `${Math.round(work.duration_s / 60)}′`
      : work.distance_m ? (work.distance_m >= 1000 ? `${work.distance_m / 1000} km` : `${work.distance_m} m`) : "";
    w = ` · ${reps}${size}`;
  }
  return `${s.date.slice(5)} ${SESSION_LABEL[s.type]}${w} · ${s.planned_km} km${s.is_hard ? " · keras" : ""}`;
}

export function diffSnapshots(a: PlanSnapshot, b: PlanSnapshot): DiffItem[] {
  const out: DiffItem[] = [];
  if (a.lthr !== b.lthr) {
    out.push({ kind: "lthr", id: "lthr", label: "LTHR", before: `${a.lthr} bpm`, after: `${b.lthr} bpm` });
  }
  const codes = new Set([...Object.keys(a.paceProfile.default), ...Object.keys(b.paceProfile.default)]);
  for (const c of codes) {
    if (!isPaced(c)) continue;
    const x = a.paceProfile.default[c];
    const y = b.paceProfile.default[c];
    if (x[0] !== y[0] || x[1] !== y[1]) {
      out.push({ kind: "pace", id: c, label: `Pace ${c}`, before: formatPaceRange(x), after: formatPaceRange(y) });
    }
    const xb = a.paceProfile.base_phase[c];
    const yb = b.paceProfile.base_phase[c];
    if (xb && yb && (xb[0] !== yb[0] || xb[1] !== yb[1])) {
      out.push({ kind: "pace", id: `${c}-base`, label: `Pace ${c} (fase Base)`, before: formatPaceRange(xb), after: formatPaceRange(yb) });
    }
  }
  const ids = new Set([...a.sessions.map((s) => s.id), ...b.sessions.map((s) => s.id)]);
  for (const id of ids) {
    const x = a.sessions.find((s) => s.id === id);
    const y = b.sessions.find((s) => s.id === id);
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const before = describeSession(x);
    const after = describeSession(y);
    if (before === after && JSON.stringify(x?.segments) === JSON.stringify(y?.segments)) continue;
    out.push({ kind: "session", id, label: id, before, after: before === after ? `${after} (segmen diubah)` : after });
  }
  return out;
}
