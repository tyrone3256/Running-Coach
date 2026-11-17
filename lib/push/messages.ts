// Isi notifikasi push (murni, tanpa I/O) — dipakai cron pagi & sore.
import type { EngineState } from "@/lib/engine/model";
import { computeHold } from "@/lib/engine/rules";
import { isActive } from "@/lib/engine/snapshot";
import { estimateDurationMin } from "@/lib/engine/pace";
import { SESSION_LABEL } from "@/lib/labels";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

const pendingCount = (st: EngineState) => st.changes.filter((c) => c.mode === "pending").length;
const todaySession = (st: EngineState) => st.snapshot.sessions.find((s) => s.date === st.today && isActive(s));

/** 05:00 WIB: sesi hari ini + check-in. Hari tanpa lari: hanya bila ada yang perlu disetujui. */
export function morningMessage(st: EngineState): PushPayload | null {
  const hold = computeHold(st);
  if (hold.active) {
    return {
      title: "Program masih ditahan",
      body: `Red flag (${hold.reasons.join(", ")}). Periksa ke dokter dulu; tandai di app setelah diperiksa.`,
      url: "/", tag: "morning",
    };
  }
  const s = todaySession(st);
  const pending = pendingCount(st);
  const pendingTxt = pending ? ` · ${pending} perubahan menunggu persetujuan` : "";
  if (s) {
    const dur = estimateDurationMin(s, st.snapshot.paceProfile);
    return {
      title: `Hari ini: ${SESSION_LABEL[s.type]}${s.is_hard ? " (keras)" : ""}`,
      body: `${s.planned_km.toLocaleString("id-ID")} km · ±${dur} menit. Isi check-in pagi dulu${pendingTxt}.`,
      url: "/", tag: "morning",
    };
  }
  if (pending) {
    return { title: "Ada perubahan program", body: `${pending} perubahan menunggu persetujuanmu.`, url: "/program/changes", tag: "morning" };
  }
  return null;
}

/** 19:00 WIB: pengingat log bila sesi hari ini belum dicatat. */
export function eveningMessage(st: EngineState): PushPayload | null {
  if (computeHold(st).active) return null;
  const s = todaySession(st);
  if (!s) return null;
  if (st.logs.some((l) => l.date === st.today)) return null;
  return {
    title: "Belum ada log hari ini",
    body: `${SESSION_LABEL[s.type]} ${s.planned_km.toLocaleString("id-ID")} km — catat hasilnya (atau tandai tidak jalan) supaya program menyesuaikan.`,
    url: `/log/new?session=${s.id}&date=${s.date}`, tag: "evening",
  };
}
