import type { EngineOutcome } from "./engine-service";

/** Ringkasan hasil engine untuk respons API / UI (tanpa data besar). */
export interface OutcomeSummary {
  applied: Array<{ id: string; rule: string; title: string; reason: string; cues?: string[] }>;
  pending: Array<{ id: string; rule: string; title: string }>;
  blocked: Array<{ id: string; rule: string; title: string; why: string[] }>;
  notices: Array<{ rule: string; level: string; message: string }>;
  hold: boolean;
}

export function summarizeOutcome(o: EngineOutcome): OutcomeSummary {
  return {
    applied: o.applied.map((c) => ({ id: c.id, rule: c.rule, title: c.title, reason: c.reason, cues: c.cues })),
    pending: o.pending.map((c) => ({ id: c.id, rule: c.rule, title: c.title })),
    blocked: o.blocked.map((c) => ({ id: c.id, rule: c.rule, title: c.title, why: c.blocked_by ?? [] })),
    notices: o.notices.map((n) => ({ rule: n.rule, level: n.level, message: n.message })),
    hold: o.hold.active,
  };
}
