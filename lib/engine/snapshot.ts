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
    case "set_race_goal":
      return { ...s, races: s.races.map((r) => (r.id === ch.race_id ? { ...r, goal_time_s: ch.goal_time_s } : r)) };
    case "set_program_tail": {
      const sessions = [...s.sessions.filter((x) => x.week < ch.from_week), ...ch.sessions]
        .sort((a, b) => a.date.localeCompare(b.date));
      const weeks = [...s.weeks.filter((w) => w.week < ch.from_week), ...ch.weeks].sort((a, b) => a.week - b.week);
      return { ...s, sessions, weeks, races: ch.races };
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
      case "set_race_goal": {
        const old = cur.races.find((r) => r.id === ch.race_id);
        if (old) inv.unshift({ op: "set_race_goal", race_id: ch.race_id, goal_time_s: old.goal_time_s });
        break;
      }
      case "set_program_tail":
        inv.unshift({
          op: "set_program_tail", from_week: ch.from_week,
          weeks: cur.weeks.filter((w) => w.week >= ch.from_week),
          sessions: cur.sessions.filter((x) => x.week >= ch.from_week),
          races: cur.races,
        });
        break;
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
  for (const r of b.races) {
    const o = a.races.find((x) => x.id === r.id);
    if (!o) out.push({ kind: "race", id: r.id, label: `Race baru`, before: "—", after: `${r.name} · ${r.date} · target ${fmtTime(r.goal_time_s)}` });
    else if (o.goal_time_s !== r.goal_time_s) out.push({ kind: "race", id: r.id, label: `Target ${r.name}`, before: fmtTime(o.goal_time_s), after: fmtTime(r.goal_time_s) });
  }
  for (const r of a.races) {
    if (!b.races.some((x) => x.id === r.id)) out.push({ kind: "race", id: r.id, label: "Race dihapus", before: `${r.name} · ${r.date}`, after: "—" });
  }
  // sesi yang ditambah/dihapus seluruhnya (program baru) diringkas per minggu
  const aIds = new Set(a.sessions.map((s) => s.id));
  const bIds = new Set(b.sessions.map((s) => s.id));
  const summarize = (list: Session[]) => {
    const byWeek = new Map<number, Session[]>();
    for (const s of list) byWeek.set(s.week, [...(byWeek.get(s.week) ?? []), s]);
    return [...byWeek.entries()].sort((x, y) => x[0] - y[0]);
  };
  for (const [w, ss] of summarize(b.sessions.filter((s) => !aIds.has(s.id)))) {
    const wk = b.weeks.find((x) => x.week === w);
    out.push({
      kind: "session", id: `W${w}-add`, label: `W${String(w).padStart(2, "0")}${wk ? ` · ${wk.phase}` : ""}`, before: "—",
      after: `${ss.length} sesi · ${Math.round(ss.reduce((t, s) => t + s.planned_km, 0))} km${ss.some((s) => s.is_hard) ? ` · keras: ${ss.filter((s) => s.is_hard).map((s) => SESSION_LABEL[s.type]).join(", ")}` : ""}`,
    });
  }
  for (const [w, ss] of summarize(a.sessions.filter((s) => !bIds.has(s.id)))) {
    out.push({ kind: "session", id: `W${w}-del`, label: `W${String(w).padStart(2, "0")}`, before: `${ss.length} sesi`, after: "dihapus" });
  }
  const ids = new Set([...a.sessions.filter((s) => bIds.has(s.id)).map((s) => s.id)]);
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

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}
