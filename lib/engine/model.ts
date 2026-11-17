// Model adaptive engine. Semua fungsi engine murni: (state, trigger) → hasil, tanpa I/O.
import type { PacedCode, PaceProfile, PaceRange, Session, Week } from "./types";
import type { WorkoutLog } from "@/lib/log/schema";

export type RuleId =
  | "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10" | "R11" | "R12" | "R13" | "manual";

/** Satu versi plan lengkap: sesi + pace profile + LTHR. */
export interface PlanSnapshot {
  version: number;
  weeks: Week[];
  sessions: Session[];
  paceProfile: PaceProfile;
  lthr: number;
  lthrSource: "estimate" | "test";
}

export type SessionPatch = Partial<Pick<
  Session, "type" | "segments" | "planned_km" | "is_hard" | "z4_target_min" | "notes" | "date" | "day" | "week" | "status" | "moved_from"
>>;

export type Change =
  | { op: "shift_pace"; codes: PacedCode[]; delta_s: number }
  | { op: "set_pace_profile"; default: Partial<Record<PacedCode, PaceRange>>; base_phase: Partial<Record<PacedCode, PaceRange>>; vdot_ref?: number }
  | { op: "set_lthr"; lthr: number; source: "estimate" | "test" }
  | { op: "update_session"; id: string; patch: SessionPatch };

export type Size = "small" | "large";

export interface Proposal {
  /** kunci dedupe: proposal dengan key sama tidak dibuat dua kali */
  key: string;
  rule: RuleId;
  size: Size;
  title: string;
  reason: string;
  changes: Change[];
  evidence?: Record<string, unknown>;
  /** opsi lain (mis. R5: LTHR saja) — dipilih user saat approve */
  alternatives?: Array<{ id: string; label: string; changes: Change[] }>;
  cues?: string[];
  /** id sesi yang disentuh (untuk resolusi konflik antar rule) */
  targets?: string[];
}

export interface Notice {
  key: string;
  rule: RuleId;
  level: "info" | "warn" | "stop";
  message: string;
  log_id?: string;
  date: string;
  cues?: string[];
}

export interface LogAnnotation {
  log_id: string;
  sensor_suspect: boolean;
  reason: string | null;
}

export interface PlanChangeRecord {
  id: string;
  key: string;
  rule: RuleId;
  size: Size;
  title: string;
  reason: string;
  changes: Change[];
  inverse: Change[] | null;
  diff: DiffItem[];
  evidence?: Record<string, unknown>;
  alternatives?: Proposal["alternatives"];
  cues?: string[];
  mode: "auto" | "approved" | "pending" | "rejected" | "blocked";
  blocked_by?: string[];
  from_version: number | null;
  to_version: number | null;
  reverted_by: string | null;
  reverts: string | null;
  created_at: string;
  date: string;
}

export interface DiffItem {
  kind: "session" | "pace" | "lthr";
  id: string;
  label: string;
  before: string;
  after: string;
}

export interface Checkin {
  date: string;
  resting_hr: number | null;
  sleep_h: number | null;
  soreness: number | null;
  pain_score: number | null;
  pain_location: string | null;
  hrv: number | null;
  temp_c?: number | null;
  humidity?: number | null;
}

export interface EngineState {
  today: string;
  snapshot: PlanSnapshot;
  logs: WorkoutLog[];
  checkins: Checkin[];
  changes: PlanChangeRecord[];
  /** tanggal user menyatakan sudah diperiksa dokter (membuka hold red flag) */
  clearances: string[];
}

export type Trigger =
  | { kind: "log"; logId: string }
  | { kind: "checkin"; date: string }
  | { kind: "daily" };

export interface EngineResult {
  proposals: Proposal[];
  blocked: Array<{ proposal: Proposal; violations: string[] }>;
  notices: Notice[];
  annotations: LogAnnotation[];
  hold: { active: boolean; since: string | null; reasons: string[] };
}
