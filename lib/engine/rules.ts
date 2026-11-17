// Rules R1–R13. Tiap rule: (state, trigger) → Proposal[] / Notice[] / LogAnnotation[]. Murni.
import type {
  Change, EngineState, LogAnnotation, Notice, PlanSnapshot, Proposal, Trigger,
} from "./model";
import type { PacedCode, Session } from "./types";
import { isActive } from "./snapshot";
import { formatPace, plannedZ4Minutes } from "./pace";
import { acwr } from "./guardrails";
import {
  CUES_HR170, EASY_TYPES, LADDER_TYPES, QUALITY_TYPES, assessQuality, hrUsable, isHot, lastAppliedDate,
  logsWithSession, nextSessionOfTypes, sensorCheck, sessionOf, sessionOnDate, weekOfDate, workSegment,
} from "./analysis";
import { cutWorkPatch, easyPatch, repMinutes, scaleEasyPatch, splitTempoPatch } from "./build";
import { addDays, daysBetween, dayKey } from "@/lib/dates";
import type { WorkoutLog } from "@/lib/log/schema";
import { SESSION_LABEL } from "@/lib/labels";
import { vdotFromRace, paceProfileFromVdot } from "./vdot";

export interface RuleOut {
  proposals: Proposal[];
  notices: Notice[];
  annotations: LogAnnotation[];
}
const empty = (): RuleOut => ({ proposals: [], notices: [], annotations: [] });

const triggerLog = (state: EngineState, t: Trigger): WorkoutLog | undefined =>
  t.kind === "log" ? state.logs.find((l) => l.id === t.logId) : undefined;

const z2Upper = (lthr: number) => Math.round(lthr * 0.89);

// =================================================================== R13 validitas sensor
export function r13(state: EngineState, t: Trigger): RuleOut {
  const out = empty();
  const log = triggerLog(state, t);
  if (!log) return out;
  const c = sensorCheck(log);
  out.annotations.push({ log_id: log.id, sensor_suspect: c.suspect, reason: c.reason });
  if (c.suspect) {
    out.notices.push({
      key: `R13:${log.id}`, rule: "R13", level: "warn", log_id: log.id, date: log.date,
      message: `Kemungkinan cadence lock: ${c.reason}. Data HR sesi ini tidak dipakai untuk penyesuaian (R1–R4, R12). Saran: pakai chest strap minimal untuk sesi kualitas & tes.`,
    });
  }
  return out;
}

// =================================================================== R1 / R2 easy terlalu berat / ringan
function easyLogsSince(state: EngineState, since: string | null) {
  return logsWithSession(state)
    .filter(({ log, session }) => EASY_TYPES.includes(session.type) && hrUsable(log) && (!since || log.date > since));
}

export function r01(state: EngineState, t: Trigger): RuleOut {
  const out = empty();
  if (t.kind !== "log") return out;
  const since = lastAppliedDate(state, ["R1", "R2", "R5"], ["E"]);
  const last3 = easyLogsSince(state, since).slice(-3);
  if (last3.length < 3) return out;
  const hi = z2Upper(state.snapshot.lthr);
  const bad = last3.filter(({ log }) => {
    const tol = log.temp_c != null && log.temp_c >= 30 ? 5 : 0;
    return log.avg_hr! > hi + tol || log.rpe >= 5;
  });
  if (bad.length < 2) return out;
  const used = state.changes
    .filter((c) => c.rule === "R1" && (c.mode === "auto" || c.mode === "approved") && !c.reverted_by
      && daysBetween(c.date, state.today) < 14)
    .reduce((a, c) => a + c.changes.reduce((s, ch) => s + (ch.op === "shift_pace" ? ch.delta_s : 0), 0), 0);
  const delta = Math.min(10, 30 - used);
  const lastId = last3[last3.length - 1].log.id;
  if (delta <= 0) {
    out.notices.push({
      key: `R1cap:${lastId}`, rule: "R1", level: "warn", date: state.today,
      message: "Easy masih terlalu berat, tapi pace sudah diperlambat maksimal 30 dtk/km dalam 2 minggu. Cek panas, tidur, sensor HR, atau kelelahan umum.",
    });
    return out;
  }
  const detail = bad.map(({ log }) => `${log.date}: HR ${log.avg_hr}, RPE ${log.rpe}${log.temp_c != null ? `, ${log.temp_c}°C` : ""}`).join("; ");
  out.proposals.push({
    key: `R1:${lastId}`, rule: "R1", size: "small",
    title: `Easy/long/recovery diperlambat ${delta} dtk/km`,
    reason: `${bad.length} dari 3 easy/long run terakhir melewati batas atas Z2 (${hi} bpm) atau RPE ≥5 (${detail}). ` +
      "Easy harus benar-benar Z2 supaya basis aerobik terbangun dan kamu segar untuk sesi kunci — HR menang atas pace.",
    changes: [{ op: "shift_pace", codes: ["E", "L", "REC"], delta_s: delta }],
    evidence: { logs: bad.map(({ log }) => log.id), z2_upper: hi },
  });
  return out;
}

export function r02(state: EngineState, t: Trigger): RuleOut {
  const out = empty();
  if (t.kind !== "log") return out;
  const since = lastAppliedDate(state, ["R1", "R2", "R5"], ["E"]);
  const last5 = easyLogsSince(state, since).slice(-5);
  if (last5.length < 5) return out;
  const lo = state.snapshot.lthr * 0.85;
  const easy = last5.filter(({ log }) => log.avg_hr! < lo && log.rpe <= 3);
  if (easy.length < 4) return out;
  out.proposals.push({
    key: `R2:${last5[4].log.id}`, rule: "R2", size: "small",
    title: "Easy/long dipercepat 5 dtk/km",
    reason: `${easy.length} dari 5 easy run terakhir di bawah 85% LTHR (<${Math.round(lo)} bpm) dengan RPE ≤3 — easy-mu sudah lebih efisien.`,
    changes: [{ op: "shift_pace", codes: ["E", "L"], delta_s: -5 }],
  });
  return out;
}

// =================================================================== R3 / R4 sesi kualitas
function qualityHistory(state: EngineState, type: Session["type"]) {
  return logsWithSession(state).filter(({ session }) => session.type === type)
    .map((x) => ({ ...x, a: assessQuality(x.log, x.session, state.snapshot.paceProfile, state.snapshot.lthr) }));
}

export function r03(state: EngineState, t: Trigger): RuleOut {
  const out = empty();
  const log = triggerLog(state, t);
  const session = log && sessionOf(state.snapshot, log);
  if (!log || !session || !QUALITY_TYPES.includes(session.type)) return out;
  const hist = qualityHistory(state, session.type);
  const me = hist.find((h) => h.log.id === log.id);
  if (!me?.a.failed) return out;
  const fails = hist.filter((h) => h.a.failed && daysBetween(h.log.date, log.date) <= 21 && h.log.date <= log.date);
  const label = SESSION_LABEL[session.type];
  if (fails.length === 2) {
    const next = nextSessionOfTypes(state.snapshot, log.date, [session.type]);
    if (next) {
      out.proposals.push({
        key: `R3:${log.id}`, rule: "R3", size: "small", targets: [next.id],
        title: `${label} berikutnya (${next.id}) volume −20%`,
        reason: `${label} gagal 2× dalam 3 minggu (${fails.map((f) => `${f.log.date}: ${f.a.reasons.join(", ")}`).join(" | ")}). ` +
          "Volume kerja sesi berikutnya dikurangi 20% supaya bisa diselesaikan dengan kualitas baik.",
        changes: [{ op: "update_session", id: next.id, patch: cutWorkPatch(next, state.snapshot.paceProfile, 0.8, "R3: volume −20% setelah 2× gagal") }],
      });
    }
  } else if (fails.length >= 3) {
    const code = workSegment(session)?.intensity as PacedCode | undefined;
    if (code) {
      out.proposals.push({
        key: `R3:${log.id}`, rule: "R3", size: "small",
        title: `Pace ${code} diperlambat 5 dtk/km`,
        reason: `${label} gagal ${fails.length}× dalam 3 minggu — target pace ${code} saat ini belum sesuai kebugaranmu.`,
        changes: [{ op: "shift_pace", codes: [code], delta_s: 5 }],
      });
    }
  }
  return out;
}

export function r04(state: EngineState, t: Trigger): RuleOut {
  const out = empty();
  const log = triggerLog(state, t);
  const session = log && sessionOf(state.snapshot, log);
  if (!log || !session || !QUALITY_TYPES.includes(session.type)) return out;
  const code = workSegment(session)?.intensity as PacedCode | undefined;
  if (!code) return out;
  const since = lastAppliedDate(state, ["R3", "R4", "R5"], [code]);
  const hist = qualityHistory(state, session.type).filter((h) => !since || h.log.date > since);
  const last3 = hist.slice(-3);
  if (last3.length < 3 || last3[2].log.id !== log.id || !last3.every((h) => h.a.easySuccess)) return out;
  out.proposals.push({
    key: `R4:${log.id}`, rule: "R4", size: "small",
    title: `Pace ${code} dipercepat 3 dtk/km`,
    reason: `3 ${SESSION_LABEL[session.type]} berturut-turut tepat pace dengan HR ≤ tengah zona dan RPE ≤7 — saatnya sedikit lebih cepat.`,
    changes: [{ op: "shift_pace", codes: [code], delta_s: -3 }],
  });
  return out;
}

// =================================================================== R12 tangga toleransi Z4
export function r12(state: EngineState, t: Trigger): RuleOut {
  const out = empty();
  const log = triggerLog(state, t);
  const session = log && sessionOf(state.snapshot, log);
  if (!log || !session) return out;
  const profile = state.snapshot.paceProfile;
  const a = assessQuality(log, session, profile, state.snapshot.lthr);

  if (session.type === "vo2_4x4" && a.cancelledForRecovery > 0) {
    out.notices.push({
      key: `R12-4x4:${log.id}`, rule: "R12", level: "info", log_id: log.id, date: log.date,
      message: `${a.cancelledForRecovery} rep 4×4 dibatalkan karena HR tidak turun ke <80% LTHR (${Math.round(state.snapshot.lthr * 0.8)} bpm) setelah ±3′ jog. Dicatat — bukan dihitung gagal.`,
    });
  }
  if (!LADDER_TYPES.includes(session.type)) return out;
  if (!hrUsable(log) && !log.discomfort_at_hr.flag && !log.reps.some((r) => r.stop_reason === "hr_tidak_nyaman")) return out;

  const ladderLogs = logsWithSession(state).filter((x) => LADDER_TYPES.includes(x.session.type) && x.log.date <= log.date);
  const idx = ladderLogs.findIndex((x) => x.log.id === log.id);
  const prev = idx > 0 ? ladderLogs[idx - 1] : undefined;

  if (a.ladderFailure) {
    const zf = Math.round(plannedZ4Minutes(session, profile));
    const prevFail = prev && assessQuality(prev.log, prev.session, profile, state.snapshot.lthr).ladderFailure;
    const sameRung = prev && (
      (prev.session.z4_target_min != null && prev.session.z4_target_min === session.z4_target_min)
      || Math.abs(plannedZ4Minutes(prev.session, profile) - zf) <= 3);
    const descend = !!(prevFail && sameRung);
    const next = nextSessionOfTypes(state.snapshot, log.date, LADDER_TYPES);
    if (!next) return out;
    const nextZ = Math.round(plannedZ4Minutes(next, profile));
    let total = descend ? Math.max(10, zf - 10) : zf;
    if (nextZ > 0) total = Math.min(total, nextZ);
    const rm = repMinutes(session, profile) ?? 10;
    const repMin = Math.max(3, Math.round(rm / 2));
    const patch = splitTempoPatch(next, total, repMin, profile,
      descend ? `R12: turun 1 anak tangga (${total}′ Z4)` : `R12: total Z4 tetap ${total}′, rep dipecah`);
    const w = patch.segments!.find((s) => s.kind === "work")!;
    const repLbl = (w.duration_s! % 60 === 0) ? `${w.duration_s! / 60}′` : `${Math.floor(w.duration_s! / 60)}′${String(w.duration_s! % 60).padStart(2, "0")}″`;
    out.proposals.push({
      key: `R12:${log.id}`, rule: "R12", size: "small", targets: [next.id], cues: CUES_HR170.slice(0, 3),
      title: descend
        ? `Tangga Z4 turun: ${next.id} jadi ${w.reps}×${repLbl} (${total}′ Z4)`
        : `${next.id} dipecah jadi ${w.reps}×${repLbl} rec 1′ (total Z4 ${total}′ tetap)`,
      reason: descend
        ? `Dua tempo berturut-turut di anak tangga yang sama tidak selesai karena HR/tidak nyaman. Turun 1 anak tangga (−10′ Z4) dulu supaya tubuh membangun toleransi tanpa gagal berulang. Coach akan meninjau readiness, panas, dan sensor HR.`
        : `Rep tempo tidak selesai karena HR 170 terasa berat. Total menit Z4 sesi berikutnya DIPERTAHANKAN (${total}′) tapi dipecah jadi rep lebih pendek dengan jog 1′ — anak tangga tidak naik minggu ini. Ini cara melatih toleransi di ambang tanpa memaksa.`,
      changes: [{ op: "update_session", id: next.id, patch }],
      evidence: { failed_session: session.id, z4_failed: zf, next_z4_planned: nextZ, descend },
    });
    if (descend) {
      out.notices.push({
        key: `R12-review:${log.id}`, rule: "R12", level: "warn", date: log.date, log_id: log.id,
        message: "2× gagal di anak tangga yang sama. Cek: tidur & HR istirahat (readiness), suhu/kelembapan saat lari, dan apakah HR dari jam bisa dipercaya (pertimbangkan chest strap).",
      });
    }
  } else if (session.z4_target_min && log.rpe <= 7 && !a.failed && prev) {
    const pa = assessQuality(prev.log, prev.session, profile, state.snapshot.lthr);
    if (!pa.failed && prev.log.rpe <= 7) {
      out.notices.push({
        key: `R12-up:${log.id}`, rule: "R12", level: "info", date: log.date, log_id: log.id,
        message: "Target Z4 tercapai dengan RPE ≤7 di 2 sesi berturut-turut — tangga boleh naik sesuai jadwal (tidak melompat).",
      });
    }
  }
  return out;
}

// =================================================================== R6 readiness
export function readiness(state: EngineState, date: string): { red: boolean; reasons: string[] } {
  const c = state.checkins.find((x) => x.date === date);
  if (!c) return { red: false, reasons: [] };
  const reasons: string[] = [];
  const prev = state.checkins
    .filter((x) => x.date < date && daysBetween(x.date, date) <= 7 && x.resting_hr != null)
    .map((x) => x.resting_hr!);
  if (c.resting_hr != null && prev.length >= 3) {
    const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
    if (c.resting_hr >= avg + 5) reasons.push(`HR istirahat ${c.resting_hr} ≥ rata-rata 7 hari (${avg.toFixed(0)}) +5`);
  }
  if (c.sleep_h != null && c.sleep_h < 6) reasons.push(`tidur ${c.sleep_h} jam`);
  if (c.soreness != null && c.soreness >= 7) reasons.push(`pegal ${c.soreness}/10`);
  return { red: reasons.length > 0, reasons };
}

export function r06(state: EngineState, t: Trigger): RuleOut {
  const out = empty();
  if (t.kind !== "checkin") return out;
  const date = t.date;
  const r = readiness(state, date);
  if (!r.red) return out;
  const yesterday = readiness(state, addDays(date, -1));
  const today = sessionOnDate(state.snapshot, date);
  if (yesterday.red) {
    out.notices.push({
      key: `R6-rest:${date}`, rule: "R6", level: "warn", date,
      message: `Dua hari berturut-turut readiness merah (${r.reasons.join(", ")}). Saran: istirahat hari ini.`,
    });
    if (today) {
      out.proposals.push({
        key: `R6-rest:${date}`, rule: "R6", size: "large", targets: [today.id],
        title: `Istirahat hari ini (${today.id})`,
        reason: `Readiness merah 2 hari berturut-turut: ${r.reasons.join(", ")}. Istirahat sehari biasanya lebih menguntungkan daripada memaksa.`,
        changes: [{ op: "update_session", id: today.id, patch: { status: "rest", notes: [...today.notes, "R6: rest (readiness merah 2 hari)"] } }],
      });
      return out;
    }
  }
  if (today?.is_hard) {
    out.proposals.push({
      key: `R6:${date}`, rule: "R6", size: "small", targets: [today.id],
      title: `${today.id}: ${SESSION_LABEL[today.type]} → easy ${today.planned_km} km`,
      reason: `Readiness pagi ini merah (${r.reasons.join(", ")}). Sesi kualitas di kondisi ini berisiko jelek & menumpuk lelah — hari ini easy saja.`,
      changes: [{ op: "update_session", id: today.id, patch: easyPatch(today, "R6: readiness merah → easy") }],
    });
  }
  return out;
}

// =================================================================== R7 sesi terlewat & absen
export function quickMoveTarget(snapshot: PlanSnapshot, missed: Session, today: string): string | null {
  const week = weekOfDate(snapshot, missed.date);
  if (!week) return null;
  const end = addDays(week.start, 6);
  const hard = snapshot.sessions.filter((s) => isActive(s) && s.is_hard && s.id !== missed.id);
  const start = addDays(missed.date, 1) > today ? addDays(missed.date, 1) : today;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const nextDay = sessionOnDate(snapshot, addDays(d, 1));
    if (nextDay && nextDay.type.startsWith("long")) continue; // bukan sehari sebelum long run
    const occupant = sessionOnDate(snapshot, d);
    if (occupant && (occupant.is_hard || occupant.type.startsWith("long") || occupant.type === "race")) continue;
    if (hard.some((h) => Math.abs(daysBetween(h.date, d)) < 2)) continue; // ≥48 jam dari sesi keras lain
    return d;
  }
  return null;
}

function moveChanges(snapshot: PlanSnapshot, s: Session, to: string, note: string): Change[] {
  const changes: Change[] = [];
  const occupant = sessionOnDate(snapshot, to);
  if (occupant) {
    changes.push({ op: "update_session", id: occupant.id, patch: { status: "rest", notes: [...occupant.notes, `R7: diganti ${s.id}`] } });
  }
  const w = weekOfDate(snapshot, to);
  changes.push({
    op: "update_session", id: s.id,
    patch: { date: to, day: dayKey(to) as Session["day"], week: w?.week ?? s.week, moved_from: s.date, notes: [...s.notes, note] },
  });
  return changes;
}

export function r07(state: EngineState, t: Trigger): RuleOut {
  const out = empty();
  const snap = state.snapshot;
  if (t.kind === "daily") {
    const done = new Set(state.logs.map((l) => l.session_key ?? `date:${l.date}`));
    const missed = snap.sessions.filter((s) => isActive(s) && s.date < state.today
      && daysBetween(s.date, state.today) <= 7 && !done.has(s.id) && !done.has(`date:${s.date}`));
    for (const s of missed) {
      const label = SESSION_LABEL[s.type];
      if (EASY_TYPES.includes(s.type) && !s.type.startsWith("long")) continue; // easy terlewat: abaikan
      if (s.type.startsWith("long")) {
        const w = weekOfDate(snap, s.date);
        const sunday = w ? addDays(w.start, 6) : null;
        if (sunday && sunday >= state.today && sunday > s.date) {
          out.proposals.push({
            key: `R7:${s.id}`, rule: "R7", size: "large", targets: [s.id],
            title: `Long run ${s.id} pindah ke Minggu ${sunday}`,
            reason: "Long run terlewat. Long run boleh dipindah ke Minggu; recovery Minggu jadi rest.",
            changes: moveChanges(snap, s, sunday, `R7: dipindah dari ${s.date}`),
          });
        } else {
          out.notices.push({ key: `R7:${s.id}`, rule: "R7", level: "info", date: state.today, message: `${label} ${s.id} terlewat dan tidak bisa dipindah — lanjut sesuai jadwal.` });
        }
        continue;
      }
      if (s.is_hard) {
        const to = quickMoveTarget(snap, s, state.today);
        if (to) {
          out.proposals.push({
            key: `R7:${s.id}`, rule: "R7", size: "large", targets: [s.id],
            title: `${label} ${s.id} pindah ke ${to}`,
            reason: "Sesi kualitas terlewat. Tanggal ini ≥48 jam dari sesi keras lain dan bukan sehari sebelum long run.",
            changes: moveChanges(snap, s, to, `R7: dipindah dari ${s.date}`),
          });
        } else {
          out.notices.push({
            key: `R7:${s.id}`, rule: "R7", level: "info", date: state.today,
            message: `${label} ${s.id} terlewat. Tidak ada hari yang ≥48 jam dari sesi keras lain dan bukan H-1 long run — dilewati saja, jangan dikejar.`,
          });
        }
      }
    }
  }
  if (t.kind === "log") {
    const log = triggerLog(state, t)!;
    const prev = state.logs.filter((l) => l.date < log.date).map((l) => l.date).sort().pop();
    if (prev && daysBetween(prev, log.date) >= 8) {
      const changes: Change[] = [];
      for (const s of snap.sessions.filter((x) => isActive(x) && x.date > log.date && daysBetween(log.date, x.date) <= 14)) {
        const firstWeek = daysBetween(log.date, s.date) <= 7;
        const f = firstWeek ? 0.7 : 0.85;
        if (firstWeek && s.is_hard) {
          const p = easyPatch(s, "R7: kembali dari absen — tanpa kualitas");
          changes.push({ op: "update_session", id: s.id, patch: { ...p, ...scaleEasyPatch({ ...s, ...p } as Session, f, "R7: 70% volume") } });
        } else if (!s.is_hard) {
          changes.push({ op: "update_session", id: s.id, patch: scaleEasyPatch(s, f, `R7: ${Math.round(f * 100)}% volume`) });
        }
      }
      if (changes.length) {
        out.proposals.push({
          key: `R7-absen:${log.id}`, rule: "R7", size: "large",
          targets: changes.map((c) => (c.op === "update_session" ? c.id : "")),
          title: "Kembali dari absen: minggu 1 = 70% tanpa kualitas, minggu 2 = 85%",
          reason: `Tidak ada lari sejak ${prev} (${daysBetween(prev, log.date)} hari). Masuk lagi bertahap mengurangi risiko cedera.`,
          changes,
        });
      }
    }
  }
  return out;
}

// =================================================================== R8 ACWR
export function r08acwr(state: EngineState, t: Trigger): RuleOut {
  const out = empty();
  if (t.kind !== "daily") return out;
  const a = acwr(state.logs, state.today);
  if (a.ratio == null) return out;
  if (a.ratio > 1.5) {
    const upcoming = state.snapshot.sessions.filter((s) => isActive(s) && !s.is_hard && s.date > state.today && daysBetween(state.today, s.date) <= 7);
    if (upcoming.length) {
      out.proposals.push({
        key: `R8-acwr:${state.today}`, rule: "R8", size: "small", targets: upcoming.map((s) => s.id),
        title: `ACWR ${a.ratio.toFixed(2)} — easy 7 hari ke depan −20%`,
        reason: `Beban 7 hari (${a.acute.toFixed(0)} km) jauh di atas rata-rata mingguan 4 minggu (${a.chronic.toFixed(0)} km). >1,5 = zona risiko cedera.`,
        changes: upcoming.map((s) => ({ op: "update_session" as const, id: s.id, patch: scaleEasyPatch(s, 0.8, "R8: ACWR >1,5") })),
      });
    }
  } else if (a.ratio > 1.3 || a.ratio < 0.8) {
    out.notices.push({
      key: `R8-acwr-info:${state.today}`, rule: "R8", level: "info", date: state.today,
      message: `ACWR ${a.ratio.toFixed(2)} (ideal 0,8–1,3).`,
    });
  }
  return out;
}

// =================================================================== R9 panas (notice harian)
export function r09(state: EngineState, t: Trigger): RuleOut {
  const out = empty();
  if (t.kind !== "checkin") return out;
  const c = state.checkins.find((x) => x.date === t.date);
  if (!c || !isHot(c.temp_c, c.humidity)) return out;
  out.notices.push({
    key: `R9:${t.date}`, rule: "R9", level: "info", date: t.date,
    message: `Panas & lembap (${c.temp_c}°C, ${c.humidity}%): pace easy/long hari ini boleh lebih lambat; sesi kualitas dinilai dari HR/RPE, bukan pace.`,
  });
  return out;
}

// =================================================================== R10 nyeri & red flag
export function computeHold(state: EngineState) {
  // clearances = timestamp ISO saat user menyatakan sudah diperiksa dokter
  const lastClear = state.clearances.slice().sort().pop() ?? "";
  const flagged = state.logs.filter((l) => l.safety?.level === "stop" && l.created_at > lastClear);
  if (!flagged.length) return { active: false, since: null, reasons: [] as string[] };
  return {
    active: true,
    since: flagged.map((l) => l.date).sort()[0],
    reasons: [...new Set(flagged.flatMap((l) => l.safety.reasons))],
  };
}

export function r10(state: EngineState, t: Trigger): RuleOut {
  const out = empty();
  const date = t.kind === "checkin" ? t.date : t.kind === "log" ? triggerLog(state, t)!.date : state.today;
  const reasons: string[] = [];
  const c = state.checkins.find((x) => x.date === date);
  if (c?.pain_score != null && c.pain_score >= 4) reasons.push(`nyeri ${c.pain_score}/10${c.pain_location ? ` (${c.pain_location})` : ""}`);
  const log = triggerLog(state, t);
  if (log && log.pain.score >= 4) reasons.push(`nyeri ${log.pain.score}/10 saat lari${log.pain.location ? ` (${log.pain.location})` : ""}`);
  // nyeri tajam/terlokalisasi >2 hari: dilaporkan 3 hari berturut-turut
  const days = [0, 1, 2].map((i) => addDays(date, -i));
  const painDay = (d: string) =>
    state.checkins.some((x) => x.date === d && (x.pain_score ?? 0) > 0 && !!x.pain_location)
    || state.logs.some((l) => l.date === d && l.pain.sharp);
  if (days.every(painDay)) reasons.push("nyeri terlokalisasi >2 hari");
  if (!reasons.length) return out;
  out.notices.push({
    key: `R10:${date}`, rule: "R10", level: "warn", date,
    message: `Nyeri tercatat (${reasons.join("; ")}). Sesi kualitas dihentikan dulu. Cek ke dokter/fisioterapis — terutama bila nyeri tajam, di satu titik, atau tidak membaik.`,
  });
  const quality = state.snapshot.sessions.filter((s) => isActive(s) && s.is_hard && s.date >= date && daysBetween(date, s.date) <= 7);
  if (quality.length) {
    out.proposals.push({
      key: `R10:${date}`, rule: "R10", size: "small", targets: quality.map((s) => s.id),
      title: `Sesi kualitas 7 hari ke depan → easy (${quality.map((s) => s.id).join(", ")})`,
      reason: `Nyeri: ${reasons.join("; ")}. Intensitas tinggi saat nyeri memperbesar risiko cedera.`,
      changes: quality.map((s) => ({ op: "update_session" as const, id: s.id, patch: easyPatch(s, "R10: nyeri → easy") })),
    });
  }
  return out;
}

// =================================================================== R5 tes / time trial
export interface TestInput {
  type: "30min" | "10k_tt";
  distance_m: number;
  duration_s: number;
  avg_hr_last20: number | null;
  date: string;
  log_id?: string;
}

export function r05FromTest(state: EngineState, input: TestInput): Proposal {
  const snap = state.snapshot;
  const vdot = vdotFromRace(input.distance_m, input.duration_s);
  const ref = snap.paceProfile.vdot_ref ?? vdotFromRace(21097.5, 6299);
  const calc = paceProfileFromVdot(vdot, snap.paceProfile, ref);
  const lthrChange: Change[] = input.avg_hr_last20
    ? [{ op: "set_lthr", lthr: Math.round(input.avg_hr_last20), source: "test" }]
    : [];
  const paceChange: Change = { op: "set_pace_profile", default: calc.default, base_phase: calc.base_phase, vdot_ref: Math.round(vdot * 10) / 10 };
  const hm = calc.predictions.hm_s;
  const fmtT = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const name = input.type === "30min" ? "Tes 30 menit" : "10K time trial";
  const pace = formatPace(input.duration_s / (input.distance_m / 1000));
  const guide = input.type === "30min"
    ? (input.distance_m >= 6300 ? "≥6,3 km = jalur 1:45 (panduan program)." : input.distance_m >= 6000
      ? "6,0–6,2 km di awal blok itu normal menurut panduan program — pertimbangkan update LTHR saja dan cek lagi di 10K TT (W14)." : "Di bawah 6,0 km — target perlu ditinjau bersama coach.")
    : (input.duration_s <= 2790 ? "≤46:30 = boleh incar ±1:43." : input.duration_s <= 2850 ? "≤47:30 = on track 1:45." : "Di atas 47:30 — target 1:45 perlu ditinjau.");
  const shifts = Object.entries(calc.shifts).map(([k, v]) => `${k} ${v! > 0 ? "+" : ""}${v}`).join(", ");
  return {
    key: `R5:${input.log_id ?? `${input.date}:${input.type}`}`, rule: "R5", size: "large",
    title: `${name}: ${(input.distance_m / 1000).toLocaleString("id-ID")} km @${pace}${input.avg_hr_last20 ? `, LTHR ${input.avg_hr_last20}` : ""}`,
    reason: `VDOT ${vdot.toFixed(1)} → prediksi HM ${fmtT(hm)}. ${guide} ` +
      `Pace dihitung relatif terhadap kalibrasi program (geser dtk/km: ${shifts}).` +
      (input.avg_hr_last20 ? ` LTHR baru = avg HR 20′ terakhir (${input.avg_hr_last20}) → semua zona bpm ikut berubah.` : ""),
    changes: [...lthrChange, paceChange],
    alternatives: lthrChange.length ? [{ id: "lthr_only", label: "LTHR saja (pace tetap)", changes: lthrChange }] : undefined,
    evidence: { vdot, ref_vdot: ref, predictions: calc.predictions, shifts: calc.shifts },
  };
}
