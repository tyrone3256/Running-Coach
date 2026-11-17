// Kosakata perubahan yang boleh diusulkan coach AI. LLM hanya memilih aksi + parameter;
// Change[] dibangun deterministik di sini dengan builder engine yang sama (build.ts),
// lalu tetap melewati guardrail. Coach tidak bisa menulis segmen/pace bebas.
import { z } from "zod";
import type { Change, PlanSnapshot, Size } from "@/lib/engine/model";
import type { PacedCode, Session } from "@/lib/engine/types";
import { cutWorkPatch, easyPatch, repMinutes, scaleEasyPatch, splitTempoPatch } from "@/lib/engine/build";
import { computeSize } from "@/lib/engine/engine";
import { isActive } from "@/lib/engine/snapshot";
import { LADDER_TYPES, sessionOnDate } from "@/lib/engine/analysis";
import { moveChanges } from "@/lib/engine/rules";
import { plannedZ4Minutes } from "@/lib/engine/pace";
import { addDays, dayKey, daysBetween } from "@/lib/dates";
import { SESSION_LABEL } from "@/lib/labels";

const PACE_CODES = ["WU", "E", "REC", "L", "M", "H", "T", "N", "JOG", "S", "TJOG"] as const;

export const coachActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("make_easy"), session_id: z.string() }),
  z.object({ action: z.literal("reduce_volume"), session_id: z.string(), factor: z.number().min(0.5).max(0.95) }),
  z.object({ action: z.literal("split_reps"), session_id: z.string(), rep_min: z.number().min(3).max(10) }),
  z.object({ action: z.literal("rest"), session_id: z.string() }),
  z.object({ action: z.literal("move"), session_id: z.string(), to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal("shift_pace"), codes: z.array(z.enum(PACE_CODES)).min(1), delta_s: z.number().int().min(-10).max(30) }),
]);
export type CoachAction = z.infer<typeof coachActionSchema>;

export type BuiltAction =
  | { ok: true; changes: Change[]; title: string; size: Size }
  | { ok: false; error: string };

const note = (s: string) => `Coach: ${s}`;

function findSession(snap: PlanSnapshot, id: string, today: string): Session | string {
  const s = snap.sessions.find((x) => x.id === id);
  if (!s) return `Sesi ${id} tidak ada. Pakai id dari get_plan (format W05-thu).`;
  if (!isActive(s)) return `Sesi ${id} sudah tidak aktif (${s.status}).`;
  if (s.date < today) return `Sesi ${id} (${s.date}) sudah lewat; hanya sesi hari ini/ke depan yang bisa diubah.`;
  return s;
}

/** Alasan target pindah ditolak — aturan sama dengan R7 (48 jam dari sesi keras, bukan H-1 long run). */
export function moveProblems(snap: PlanSnapshot, s: Session, to: string, today: string): string[] {
  const out: string[] = [];
  if (to < today) out.push("tanggal tujuan sudah lewat");
  if (to === s.date) out.push("tanggal sama");
  if (Math.abs(daysBetween(s.date, to)) > 6) out.push("pindah maksimal dalam minggu yang sama (±6 hari)");
  const occupant = sessionOnDate(snap, to);
  if (occupant && (occupant.is_hard || occupant.type.startsWith("long") || occupant.type === "race")) {
    out.push(`${to} sudah berisi ${SESSION_LABEL[occupant.type]}`);
  }
  if (s.is_hard) {
    const next = sessionOnDate(snap, addDays(to, 1));
    if (next && (next.type.startsWith("long") || next.type === "shakeout" || next.type === "race")) {
      out.push(`sesi keras tidak boleh H-1 ${SESSION_LABEL[next.type]}`);
    }
    if (dayKey(to) === "fri") out.push("sesi keras tidak dipindah ke Jumat (H-1 hari Sabtu)");
    const others = snap.sessions.filter((h) => isActive(h) && h.is_hard && h.id !== s.id && (!occupant || h.id !== occupant.id));
    const near = others.find((h) => Math.abs(daysBetween(h.date, to)) < 2);
    if (near) out.push(`kurang dari 48 jam dari sesi keras ${near.id} (${near.date})`);
  }
  return out;
}

export function buildCoachAction(snap: PlanSnapshot, a: CoachAction, today: string): BuiltAction {
  let changes: Change[];
  let title: string;
  let forceLarge = false;
  if (a.action === "shift_pace") {
    changes = [{ op: "shift_pace", codes: a.codes as PacedCode[], delta_s: a.delta_s }];
    title = `Pace ${a.codes.join("/")} ${a.delta_s > 0 ? "+" : ""}${a.delta_s} dtk/km`;
    forceLarge = a.delta_s < 0; // mempercepat = menambah beban → selalu minta persetujuan
  } else {
    const s = findSession(snap, a.session_id, today);
    if (typeof s === "string") return { ok: false, error: s };
    const label = `${SESSION_LABEL[s.type]} ${s.id}`;
    switch (a.action) {
      case "make_easy":
        if (!s.is_hard && s.type === "easy") return { ok: false, error: `${s.id} sudah easy.` };
        changes = [{ op: "update_session", id: s.id, patch: easyPatch(s, note("diturunkan ke easy")) }];
        title = `${label} → easy`;
        break;
      case "reduce_volume": {
        const pct = Math.round((1 - a.factor) * 100);
        const patch = s.is_hard
          ? cutWorkPatch(s, snap.paceProfile, a.factor, note(`volume kerja −${pct}%`))
          : scaleEasyPatch(s, a.factor, note(`volume −${pct}%`));
        changes = [{ op: "update_session", id: s.id, patch }];
        title = `${label}: volume −${pct}%`;
        break;
      }
      case "split_reps": {
        if (!LADDER_TYPES.includes(s.type)) return { ok: false, error: `split_reps hanya untuk tempo / HM pace, bukan ${s.type}.` };
        const total = s.z4_target_min ?? Math.round(plannedZ4Minutes(s, snap.paceProfile));
        const cur = repMinutes(s, snap.paceProfile);
        if (!total) return { ok: false, error: `${s.id} tidak punya menit Z4 terencana.` };
        if (cur != null && a.rep_min >= cur) return { ok: false, error: `Rep sekarang ±${cur.toFixed(0)}′; split harus lebih pendek.` };
        changes = [{ op: "update_session", id: s.id, patch: splitTempoPatch(s, total, a.rep_min, snap.paceProfile, note(`dipecah jadi rep ±${a.rep_min}′, total Z4 tetap`)) }];
        title = `${label}: pecah rep ±${a.rep_min}′ (total Z4 ${total}′ tetap)`;
        break;
      }
      case "rest":
        changes = [{ op: "update_session", id: s.id, patch: { status: "rest", notes: [...s.notes, note("rest")] } }];
        title = `${label} → rest`;
        break;
      case "move": {
        const probs = moveProblems(snap, s, a.to_date, today);
        if (probs.length) return { ok: false, error: `Tidak bisa pindah ke ${a.to_date}: ${probs.join("; ")}.` };
        changes = moveChanges(snap, s, a.to_date, note(`dipindah dari ${s.date}`));
        title = `${label}: pindah ${s.date} → ${a.to_date}`;
        break;
      }
    }
  }
  const size: Size = forceLarge ? "large" : computeSize(snap, changes);
  return { ok: true, changes, title, size };
}
